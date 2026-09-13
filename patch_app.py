import re

with open('client/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace getClientFallbackResponse fallback
content = re.sub(
    r'// 2\. Built-in intelligent deterministic response\s*return generateClientFallbackReply\(cleanText, history\);',
    r'''// 2. Fallback if backend is completely unavailable
    return {
      responseMode: 'TEXT',
      spoken: 'I am sorry, but the backend is currently unavailable.',
      text: '?? **Backend Unavailable**\\n\\nI am sorry, but the backend service is currently unavailable. Please check your connection or start the server.',
      visualType: 'text',
      title: 'Error'
    };''',
    content
)

# Optional: remove generateClientFallbackReply entirely, or just leave it dead code.

with open('client/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
