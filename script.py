import os

with open('.env.example', 'r', encoding='utf-8') as f:
    env_content = f.read()

env_content = env_content.replace('RIME_API_KEY\n', 'RIME_API_KEY=your_rime_api_key_here\n')
env_content = env_content.replace('LLM_API_KEY\n', 'LLM_API_KEY=your_llm_api_key_here\n')

with open('.env.example', 'w', encoding='utf-8') as f:
    f.write(env_content)

with open('README.md', 'r', encoding='utf-8') as f:
    readme = f.read()

# 1. Fix git clone instructions
readme = readme.replace('git clone https://github.com/tribhu05/Aurora-Realtime-AI-Orchestration-Engine.git\ncd aurora', 'git clone https://github.com/tribhu05/Aurora-Realtime-AI-Orchestration-Engine.git aurora\ncd aurora')

# 2. Add Live Demo section
live_demo = '''## ?? Live Demo

Frontend: [https://aurora-realtime-ai-orchestration-en.vercel.app/](https://aurora-realtime-ai-orchestration-en.vercel.app/)

*Note: The frontend is hosted on Vercel, and the real-time WebSocket backend is hosted separately on Railway (since Vercel doesn\\'t support persistent WebSocket servers). If the WS URL is not the current origin, configure the "Real-Time Backend Server" field in Settings.*
'''
readme = readme.replace('</div>\n\n---\n\n## ??? Overview', '</div>\n\n---\n\n' + live_demo + '\n---\n\n## ??? Overview')

# 3. Update env block in README
readme = readme.replace('RIME_API_KEY\n', 'RIME_API_KEY=your_rime_api_key_here\n')
readme = readme.replace('LLM_API_KEY\n', 'LLM_API_KEY=your_llm_api_key_here\n')

with open('README.md', 'w', encoding='utf-8') as f:
    f.write(readme)
print('Done!')
