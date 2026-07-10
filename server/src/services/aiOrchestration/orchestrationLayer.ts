import { EventEmitter } from 'events';

export enum ServiceType {
  LLM = 'llm',
  MULTIMODAL = 'multimodal',
}

export enum ServiceStatus {
  AVAILABLE = 'available',
  DEGRADED = 'degraded',
  UNAVAILABLE = 'unavailable',
}

export class AIOrchestrationLayer extends EventEmitter {
  async initialize(): Promise<void> {}

  async generateEmbedding(_options?: any): Promise<{ embedding: number[] }> {
    throw new Error('Embeddings are not initialized in the server control plane');
  }

  getServiceStatus(_serviceType?: ServiceType): ServiceStatus {
    return ServiceStatus.UNAVAILABLE;
  }

  async generateChatCompletion(_messages?: any, _options?: any): Promise<any> {
    throw new Error('AI orchestration voice layer removed');
  }
}

let orchestrationLayer: AIOrchestrationLayer | null = null;

export async function initializeAIOrchestration(): Promise<AIOrchestrationLayer> {
  if (!orchestrationLayer) {
    orchestrationLayer = new AIOrchestrationLayer();
    await orchestrationLayer.initialize();
  }

  return orchestrationLayer;
}

export function getAIOrchestration(): AIOrchestrationLayer | null {
  return orchestrationLayer;
}

export default AIOrchestrationLayer;
