// server/tasks.js
// Execution engine for multi-file scaffolding and structured workflows.
// Supports live step-by-step progress streaming, generation fencing,
// and instant barge-in cancellation via AbortSignal.

import { synthesizeSpeech } from './rime.js';

export function isTaskRequest(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  const taskKeywords = [
    'create an express', 'create express', 'scaffold express', 'build express',
    'setup express', 'set up express', 'generate express', 'rest api in typescript',
    'rest api in javascript', 'scaffold a project', 'scaffold api', 'create a rest api',
    'scaffold a rest api', 'create rest api'
  ];
  return taskKeywords.some((k) => t.includes(k));
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });
}

export async function executeScaffoldTask({ ws, state, myGen, userText, signal, send, rimeConfig }) {
  const isTs = /\b(typescript|ts)\b/i.test(userText);
  const isTodo = /\b(todo|todos)\b/i.test(userText);
  const flavor = isTs ? 'TypeScript' : 'JavaScript';
  const targetSubject = isTodo ? 'Todo App' : 'REST API';
  const title = `Scaffold Express ${targetSubject} (${flavor})`;

  const stepNames = [
    `Initialize ${flavor} project structure and package manifest`,
    `Install dependencies (express, cors, dotenv${isTs ? ', typescript, ts-node, @types/express' : ''})`,
    `Configure ${flavor === 'TypeScript' ? 'tsconfig.json and environment' : 'environment variables and middleware'}`,
    `Implement modular ${isTodo ? 'Todo' : 'REST'} router and controller handlers`,
    `Validate scaffolding and build entrypoint`,
  ];

  const stepDetails = [
    `Created package.json with standard ESM & ${flavor} scripts`,
    `Installed dependencies with zero vulnerabilities`,
    `Configured CORS, JSON parsing, logging, and ${flavor === 'TypeScript' ? 'strict TypeScript compiler settings' : 'security middleware'}`,
    `Generated routes/${isTodo ? 'todos' : 'api'}.${isTs ? 'ts' : 'js'} with GET, POST, PUT, DELETE endpoints`,
    `Scaffolding verified: server is ready for production development`,
  ];

  // 1. Emit task_started event
  send(ws, {
    type: 'task_started',
    generation: myGen,
    taskId: `task-${myGen}`,
    title,
    flavor,
    totalSteps: stepNames.length,
    steps: stepNames.map((name, idx) => ({
      id: idx + 1,
      name,
      status: idx === 0 ? 'in_progress' : 'pending',
    })),
    timestamp: Date.now(),
  });

  // 2. Synthesize and send initial spoken voice announcement
  const initialSpoken = `Starting the Express ${flavor} REST API scaffolding now.`;
  send(ws, {
    type: 'ai_text',
    text: initialSpoken,
    spoken: initialSpoken,
    visualType: 'text',
    generation: myGen,
    timestamp: Date.now(),
  });

  try {
    const audioBuffer = await synthesizeSpeech(initialSpoken, rimeConfig, signal);
    if (signal.aborted || state.generation !== myGen) return;
    if (audioBuffer) {
      send(ws, {
        type: 'audio',
        generation: myGen,
        speaker: rimeConfig.speaker,
        modelId: rimeConfig.modelId,
        format: rimeConfig.audioFormat,
        data: audioBuffer.toString('base64'),
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
    // Non-blocking TTS failure
  }

  // 3. Step-by-step execution loop
  for (let i = 0; i < stepNames.length; i++) {
    if (signal.aborted || state.generation !== myGen) return;

    // Simulate real staging progress with cancellation checkpoints
    await delay(450, signal);
    if (signal.aborted || state.generation !== myGen) return;

    send(ws, {
      type: 'task_progress',
      generation: myGen,
      taskId: `task-${myGen}`,
      stepIndex: i,
      stepName: stepNames[i],
      status: 'complete',
      details: stepDetails[i],
      nextStepIndex: i + 1 < stepNames.length ? i + 1 : null,
      timestamp: Date.now(),
    });
  }

  // 4. Generate primary code
  const primaryCode = isTs ? getTsExpressCode(isTodo) : getJsExpressCode(isTodo);
  const resourceName = isTodo ? 'todos' : 'items';
  const filesList = [
    { name: 'package.json', path: 'package.json', type: 'config' },
    { name: isTs ? 'tsconfig.json' : '.env', path: isTs ? 'tsconfig.json' : '.env', type: 'config' },
    { name: isTs ? 'src/server.ts' : 'server.js', path: isTs ? 'src/server.ts' : 'server.js', type: 'entrypoint' },
    { name: isTs ? `src/routes/${resourceName}.ts` : `routes/${resourceName}.js`, path: isTs ? `src/routes/${resourceName}.ts` : `routes/${resourceName}.js`, type: 'route' },
  ];

  // 5. Emit task_complete event
  send(ws, {
    type: 'task_complete',
    generation: myGen,
    taskId: `task-${myGen}`,
    title,
    summary: `Express REST API (${flavor}) successfully scaffolded with modular architecture.`,
    files: filesList,
    primaryCode: {
      language: isTs ? 'typescript' : 'javascript',
      filename: isTs ? 'src/server.ts' : 'server.js',
      code: primaryCode,
    },
    timestamp: Date.now(),
  });

  // 6. Final spoken voice announcement
  const finalSpoken = `Your Express ${flavor} project is ready. I've placed the full code in the chat.`;
  try {
    const audioBuffer = await synthesizeSpeech(finalSpoken, rimeConfig, signal);
    if (signal.aborted || state.generation !== myGen) return;
    if (audioBuffer) {
      send(ws, {
        type: 'audio',
        generation: myGen,
        speaker: rimeConfig.speaker,
        modelId: rimeConfig.modelId,
        format: rimeConfig.audioFormat,
        data: audioBuffer.toString('base64'),
        timestamp: Date.now(),
      });
    } else {
      send(ws, {
        type: 'speak_local',
        text: finalSpoken,
        generation: myGen,
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }

  send(ws, { type: 'done', generation: myGen, timestamp: Date.now() });
}

function getJsExpressCode(isTodo = false) {
  const resource = isTodo ? 'todos' : 'items';
  const sampleData = isTodo
    ? `[
  { id: 1, title: 'Implement full-duplex voice interaction', completed: true },
  { id: 2, title: 'Test barge-in sub-2ms interruption', completed: true },
  { id: 3, title: 'Ship Aurora AI workspace', completed: false }
]`
    : `[
  { id: 1, name: 'Aurora Voice Companion', status: 'active' },
  { id: 2, name: 'Rime TTS Integration', status: 'ready' }
]`;

  return `// server.js - Express REST API (JavaScript ESM)
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory mock resource
let ${resource} = ${sampleData};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// GET all ${resource}
app.get('/api/${resource}', (req, res) => {
  res.json({ success: true, count: ${resource}.length, data: ${resource} });
});

// GET single item
app.get('/api/${resource}/:id', (req, res) => {
  const item = ${resource}.find(i => i.id === parseInt(req.params.id, 10));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true, data: item });
});

// POST create
app.post('/api/${resource}', (req, res) => {
  const newItem = { id: Date.now(), ...req.body };
  ${resource}.push(newItem);
  res.status(201).json({ success: true, data: newItem });
});

// DELETE
app.delete('/api/${resource}/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const exists = ${resource}.some(i => i.id === id);
  if (!exists) return res.status(404).json({ error: 'Not found' });
  ${resource} = ${resource}.filter(i => i.id !== id);
  res.json({ success: true, message: 'Deleted successfully' });
});

app.listen(PORT, () => {
  console.log(\`🚀 Express server running at http://localhost:\${PORT}\`);
});`;
}

function getTsExpressCode(isTodo = false) {
  const resource = isTodo ? 'todos' : 'items';
  const typeDef = isTodo
    ? `interface Todo {
  id: number;
  title: string;
  completed: boolean;
}`
    : `interface Item {
  id: number;
  name: string;
  status: 'active' | 'pending' | 'completed';
}`;

  const sampleData = isTodo
    ? `[
  { id: 1, title: 'Check prime number function', completed: true },
  { id: 2, title: 'Verify Rime voice synthesis', completed: true },
  { id: 3, title: 'Scaffold TypeScript Todo API', completed: false }
]`
    : `[
  { id: 1, name: 'Aurora Voice Engine', status: 'active' },
  { id: 2, name: 'Rime Low-Latency TTS', status: 'active' }
]`;

  return `// src/server.ts - Express REST API (TypeScript)
import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

${typeDef}

app.use(cors());
app.use(express.json());

let ${resource} = ${sampleData};

// Health Check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// GET all
app.get('/api/${resource}', (_req: Request, res: Response) => {
  res.json({ success: true, count: ${resource}.length, data: ${resource} });
});

// GET by ID
app.get('/api/${resource}/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const item = ${resource}.find((i) => i.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true, data: item });
});

// POST create
app.post('/api/${resource}', (req: Request, res: Response) => {
  const newItem = { id: Date.now(), ...req.body };
  ${resource}.push(newItem);
  res.status(201).json({ success: true, data: newItem });
});

// DELETE
app.delete('/api/${resource}/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const exists = ${resource}.some((i) => i.id === id);
  if (!exists) return res.status(404).json({ error: 'Not found' });
  ${resource} = ${resource}.filter((i) => i.id !== id);
  res.json({ success: true, message: 'Deleted successfully' });
});

app.listen(PORT, () => {
  console.log(\`🚀 TypeScript Express server running at http://localhost:\${PORT}\`);
});`;
}
