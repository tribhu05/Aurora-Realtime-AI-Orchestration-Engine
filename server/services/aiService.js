import dotenv from 'dotenv';
dotenv.config();
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function getAIResponse(userMessage, conversationHistory = []) {
  try {
    const messages = [
      ...conversationHistory.filter((m) => m.role === 'user' || m.role === 'assistant'),
      { role: 'user', content: userMessage },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: messages,
    });

    return {
      success: true,
      answer: response.content[0].text,
      type: 'general',
    };
  } catch (error) {
    console.error('Anthropic API Error:', error);
    return {
      success: false,
      answer: 'I am sorry, I encountered an error connecting to the AI service.',
      type: 'error',
    };
  }
}
