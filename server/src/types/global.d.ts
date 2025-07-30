// Global type definitions
declare global {
  namespace NodeJS {
    interface Global {
      socket: import('socket.io').Socket;
      currentSessionId: string | null;
      campaignId: string | null;
      userId: string | null;
      testId: string | null;
      sttLatencyStart: number;
      llmLatencyStart: number;
      ttsLatencyStart: number;
      response: string;
      llmLatency: number;
    }
  }
}
