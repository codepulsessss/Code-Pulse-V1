import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export const createGemini = () => {
  return new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.2,
  });
};