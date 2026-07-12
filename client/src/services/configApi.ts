import api from "./api";

export const configApi = {
  getConfiguration: async () => {
    const response = await api.get("/configuration");
    return response.data;
  },

  updateConfiguration: async (payload: object) => {
    const response = await api.put("/configuration", payload);
    return response.data;
  },

  verifyDeepgram: async () => {
    const response = await api.post("/configuration/verify-deepgram");
    return response.data;
  },

  verifyLlm: async (provider: string) => {
    const response = await api.post("/configuration/verify-llm", { provider });
    return response.data;
  },

  getLLMOptions: async () => {
    const response = await api.get("/configuration/llm-options");
    return response.data;
  },

  getVoiceOptions: async () => {
    const response = await api.get("/configuration/voice-options");
    return response.data;
  },
};
