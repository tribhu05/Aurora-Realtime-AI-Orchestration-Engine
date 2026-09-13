import re

with open('server/llm.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add Anthropic to ENDPOINTS
if 'anthropic:' not in content:
    content = content.replace(
        \"gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',\",
        \"gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',\\n  anthropic: 'https://api.anthropic.com/v1/messages',\"
    )

with open('server/llm.js', 'w', encoding='utf-8') as f:
    f.write(content)
