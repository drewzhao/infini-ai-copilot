import * as vscode from "vscode";
import {
  CancellationToken,
  LanguageModelChatInformation,
  LanguageModelChatProvider,
  LanguageModelChatRequestMessage,
  ProvideLanguageModelChatResponseOptions,
  LanguageModelResponsePart2,
  Progress,
} from "vscode";

import { createRetryConfig, ensureApiKey, executeWithRetry, fetchModels, getActivePlan } from "./utils";
import { AnthropicApi } from "./anthropic/anthropicApi";
import { AnthropicRequestBody } from "./anthropic/anthropicTypes";
import { VertexApi } from "./vertex/vertexApi";
import { VertexRequestBody } from "./vertex/vertexTypes";
import { prepareTokenCount } from "./provideToken";
import { updateContextStatusBar } from "./statusBar";
import { OpenaiApi } from "./openai/openaiApi";
import { InfiniAIModelInfo } from "./types";
import { resolveImageInputCapability } from "./modelCapabilities";


const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * VS Code Chat provider backed by InfiniAI Inference Providers.
 */
export class InfiniAIChatModelProvider implements LanguageModelChatProvider {
  /** Track last request completion time for delay calculation. */
  private _lastRequestTime: number | null = null;

  private _models: InfiniAIModelInfo[] = [];

  /**
 * Create a provider using the given secret storage for the API key.
 * @param secrets VS Code secret storage.
 */
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly userAgent: string,
    private readonly statusBarItem: vscode.StatusBarItem,
    private readonly output: vscode.OutputChannel
  ) { }

  /**
   * Get the list of available language models contributed by this provider
   * @param options Options which specify the calling context of this function
   * @param token A cancellation token which signals if the user cancelled the request or not
   * @returns A promise that resolves to the list of available language models
   */
  async provideLanguageModelChatInformation(options: vscode.PrepareLanguageModelChatModelOptions, token: CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
    try {
      const apiKey = await ensureApiKey(options.silent, this.secrets);
      if (!apiKey) {
        if (options.silent) {
          return [];
        } else {
          throw new Error("InfiniAI API key not found");
        }
      }
      const { models } = await fetchModels(apiKey, this.userAgent, this.output);
      this._models = models;
      this.output.appendLine(`Fetched ${models.length} models from InfiniAI API.`);

      const cfg = vscode.workspace.getConfiguration("infiniai");
      const enablePatterns = cfg.get<string[]>("imageInputModels", []);
      const disablePatterns = cfg.get<string[]>("disableImageInputModels", []);

      return models.map(m => {
        // Infer context length from model name or use defaults
        const contextLength = this.inferContextLength(m.id) || DEFAULT_CONTEXT_LENGTH;
        const maxOutput = DEFAULT_MAX_TOKENS;
        const maxInput = Math.max(1, contextLength - maxOutput);

        return {
          id: m.id,
          name: m.id,
          tooltip: 'InfiniAI Model ' + m.id,
          detail: 'InfiniAI',
          family: 'oai-compatible',
          version: m.created?.toString() || '1.0.0',
          maxInputTokens: maxInput,
          maxOutputTokens: maxOutput,
          capabilities: {
            toolCalling: !m.id.includes('embed') && !m.id.includes('reranker'),
            imageInput: resolveImageInputCapability(m as any, { enablePatterns, disablePatterns }),
          },
        } as LanguageModelChatInformation;
      });
    } catch (err) {
      this.output.appendLine(`Error in provideLanguageModelChatInformation: ${err instanceof Error ? err.message : String(err)}`);
      console.error("[InfiniAI Model Provider] Failed to provide model information", err);
      return [];
    }
  }

  private inferContextLength(modelId: string): number | undefined {
    // Common patterns in model names
    if (modelId.includes('128k')) return 128000;
    if (modelId.includes('32k')) return 32000;
    if (modelId.includes('16k')) return 16000;
    if (modelId.includes('8k')) return 8000;
    if (modelId.includes('4k')) return 4000;
    // Default for various models
    if (modelId.includes('qwen3-235b') || modelId.includes('deepseek-v3')) return 64000;
    if (modelId.includes('qwen') || modelId.includes('glm')) return 32000;
    return undefined;
  }

  private isSupportMessage(model: vscode.LanguageModelChatInformation): boolean {
    const family = model.family?.toLowerCase() || "";
    return family.includes('messages');
  }

  private isSupportResponse(model: vscode.LanguageModelChatInformation): boolean {
    const family = model.family?.toLowerCase() || "";
    return family.includes('responses');
  }

  private isSupportGeneration(model: vscode.LanguageModelChatInformation): boolean {
    const family = model.family?.toLowerCase() || "";
    return family.includes('generate');
  }

  private isSupportChat(model: vscode.LanguageModelChatInformation): boolean {
    const family = model.family?.toLowerCase() || "";
    return family.includes('chat.completions');
  }

  private isSupportReasoning(model: vscode.LanguageModelChatInformation): boolean {
    return model.family?.endsWith('-1') || false;
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<vscode.LanguageModelResponsePart>,
    token: CancellationToken) {
    const infiniAIModel = this._models.find(m => m.id === model.id);
    try { this.output.appendLine(`Starting provideLanguageModelChatResponse ${model.family}`); } catch { } // for debug breakpoint
    // Update Token Usage
    updateContextStatusBar(messages, model, this.statusBarItem);

    // Apply delay between consecutive requests
    const config = vscode.workspace.getConfiguration();
    const delayMs = config.get<number>("infiniai.delay", 0);

    if (delayMs > 0 && this._lastRequestTime !== null) {
      const elapsed = Date.now() - this._lastRequestTime;
      if (elapsed < delayMs) {
        const remainingDelay = delayMs - elapsed;
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            clearTimeout(timeout);
            resolve();
          }, remainingDelay);
        });
      }
    }

    const trackingProgress: Progress<LanguageModelResponsePart2> = {
      report: (part) => {
        try {
          // @ts-expect-error not error
          progress.report(part);
        } catch (e) {
          const msg = `[InfiniAI Model Provider] Progress.report failed modelId=${model.id} error=${e instanceof Error ? e.message : String(e)}`;
          try { this.output.appendLine(msg); } catch { console.error(msg); }
        }
      },
    };

    try {
      const apiKey = await ensureApiKey(false, this.secrets);
      if (!apiKey) {
        throw new Error("InfiniAI API key not found");
      }
      // get model config from user settings
      const config = vscode.workspace.getConfiguration();
      const plan = getActivePlan();
      if (this.isSupportMessage(model)) {
        const anthropicKey = plan === "coding" ? "infiniai.coding.anthropic.baseUrl" : "infiniai.anthropic.baseUrl";
        const BASE_URL = config.get<string>(anthropicKey, "https://cloud.infini-ai.com/maas");
        // Anthropic API mode
        const anthropicApi = new AnthropicApi();
        const anthropicMessages = anthropicApi.convertMessages(messages, {
          includeReasoningInRequest: false,
          supportParameters: "",
        });

        // requestBody
        let requestBody: AnthropicRequestBody = {
          model: model.id,
          messages: anthropicMessages,
          stream: true,
          max_tokens: model.maxOutputTokens || DEFAULT_MAX_TOKENS,
        };
        requestBody = anthropicApi.prepareRequestBody(requestBody, {
          id: model.id,
          max_tokens: model.maxOutputTokens,
        } as any, options);

        // send Anthropic chat request with retry
        const response = await executeWithRetry(async () => {
          const res = await fetch(`${BASE_URL.replace(/\/+$/, "")}/v1/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": this.userAgent,
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(requestBody),
          });

          if (!res.ok) {
            const errorText = await res.text();
            const msg = `[Anthropic Provider] Anthropic API error response status=${res.status} statusText=${res.statusText} body=${errorText}`;
            try { this.output.appendLine(msg); } catch { console.error(msg); }
            throw new Error(
              `Anthropic API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ""}`
            );
          }

          return res;
        }, createRetryConfig());

        if (!response.body) {
          throw new Error("No response body from Anthropic API");
        }
        await anthropicApi.processStreamingResponse(response.body, trackingProgress, token);
      } else {
        const openaiKey = plan === "coding" ? "infiniai.coding.baseUrl" : "infiniai.baseUrl";
        const BASE_URL = config.get<string>(openaiKey, "https://cloud.infini-ai.com/maas/v1");
        // OpenAI compatible API mode (default)
        const openaiApi = new OpenaiApi();
        const openaiMessages = openaiApi.convertMessages(messages, {
          includeReasoningInRequest: false,
        });

        // requestBody
        let requestBody: Record<string, unknown> = {
          model: model.id,
          messages: openaiMessages,
          stream: true,
          stream_options: { include_usage: true },
        };
        requestBody = openaiApi.prepareRequestBody(requestBody, infiniAIModel, options);

        // send chat request with retry
        const response = await executeWithRetry(async () => {
          const res = await fetch(`${BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": this.userAgent,
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
          });

          if (!res.ok) {
            const errorText = await res.text();
            const msg = `[InfiniAI Provider] InfiniAI API error response status=${res.status} statusText=${res.statusText} body=${errorText}`;
            try { this.output.appendLine(msg); } catch { console.error(msg); }
            throw new Error(
              `[InfiniAI Provider] InfiniAI API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ""}`
            );
          }

          return res;
        }, createRetryConfig());

        if (!response.body) {
          const msg = "[InfiniAI Provider] No response body from InfiniAI API";
          try { this.output.appendLine(msg); } catch { console.error(msg); }
          throw new Error("No response body from InfiniAI API");
        }
        await openaiApi.processStreamingResponse(response.body, trackingProgress, token);
      }
    } catch (err) {
      console.error("[InfiniAI Model Provider] Chat request failed", {
        modelId: model.id,
        messageCount: messages.length,
        error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
      });
      throw err;
    } finally {
      // Update last request time after successful completion
      this._lastRequestTime = Date.now();
    }
  }

  /**
   * Returns the number of tokens for a given text using the model specific tokenizer logic
   * @param model The language model to use
   * @param text The text to count tokens for
   * @param token A cancellation token for the request
   * @returns A promise that resolves to the number of tokens
   */
  async provideTokenCount(
    model: LanguageModelChatInformation,
    text: string | LanguageModelChatRequestMessage,
    _token: CancellationToken
  ): Promise<number> {
    return prepareTokenCount(model, text, _token);
  }
}
