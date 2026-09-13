import re

with open('server/server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# I will add Anthropic support to getAssistantReply in server/llm.js instead, which is cleaner and respects streaming, OR I can just do what they asked.

# Let's import getAIResponse in server.js
if 'getAIResponse' not in content:
    content = content.replace(
        \"import { getAssistantReply, localFallbackReply } from './llm.js';\",
        \"import { getAssistantReply, localFallbackReply } from './llm.js';\\nimport { getAIResponse } from './services/aiService.js';\"
    )

with open('server/server.js', 'w', encoding='utf-8') as f:
    f.write(content)
