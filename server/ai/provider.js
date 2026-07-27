const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const MAX_TOKENS = 1024;
// Safety cap on how many times we let the model call tools in one turn.
// Real production values are 5-10; 3 is plenty for our single-tool app.
const MAX_TOOL_ITERATIONS = 3;

/**
 * Stream a reply from the model.
 *
 * @param {object}   opts
 * @param {string}   opts.system          System prompt.
 * @param {object[]} opts.messages        Prior conversation turns, [{role, content}].
 * @param {function} opts.onToken         Called with each text delta as it streams.
 * @param {object[]} [opts.tools]         Optional tools the model may call.
 *                                        Each is { declaration, execute }:
 *                                          declaration = Gemini FunctionDeclaration
 *                                          execute     = async (args) => any-JSON result
 * @returns {Promise<string>} The final answer text.
 */
async function streamReply({ system, messages, onToken, tools }) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const geminiTools = tools?.length
    ? [{ functionDeclarations: tools.map((t) => t.declaration) }]
    : undefined;

  let finalText = '';

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents,
      config: {
        systemInstruction: system,
        maxOutputTokens: MAX_TOKENS,
        ...(geminiTools && { tools: geminiTools }),
      },
    });

    let iterationText = '';
    const toolCalls = [];

    for await (const chunk of stream) {
      const delta = chunk.text;
      if (delta) {
        iterationText += delta;
        onToken(delta);
      }
      if (chunk.functionCalls?.length) {
        toolCalls.push(...chunk.functionCalls);
      }
    }

    if (toolCalls.length === 0) {
      // Plain text response — this is our final answer, we're done.
      finalText = iterationText;
      break;
    }

    // Model asked us to call one or more tools. We need to:
    // 1. Append the model's tool-call turn to the conversation.
    // 2. Execute each tool.
    // 3. Append the tool responses as the next user turn.
    // 4. Loop: send back to model so it can produce a text answer.
    contents.push({
      role: 'model',
      parts: toolCalls.map((tc) => ({
        functionCall: { name: tc.name, args: tc.args },
      })),
    });

    const responseParts = [];
    for (const tc of toolCalls) {
      const tool = tools.find((t) => t.declaration.name === tc.name);
      let response;
      if (!tool) {
        response = { error: `Unknown tool: ${tc.name}` };
      } else {
        try {
          response = await tool.execute(tc.args || {});
        } catch (err) {
          console.warn(`[provider] tool ${tc.name} failed:`, err.message);
          response = { error: err.message };
        }
      }
      responseParts.push({
        functionResponse: { name: tc.name, response },
      });
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  return finalText;
}

module.exports = { streamReply };
