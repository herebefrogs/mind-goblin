import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import striptags from 'striptags'

const FUNCTIONS = {
  search_wikipedia: searchWikipedia,
  get_current_time: getCurrentTime,
  delegate_task: delegateTask
}
const TOOL_CALL_START = '<tool_call>'
const TOOL_CALL_END = '</tool_call>'
const STOP = ['<|im_end|>', 'Reference(s)', '<|im_end>', '<|im_continuation|>']
const USER = 'user'
const SYSTEM = 'system'
const ASSISTANT = 'assistant'
const TOOL = 'tool'
const PRE_GENERATE = `\n<|im_start>${ASSISTANT}\nOkay, `
const POST_TOOL = "Does this answer the user's query? If not I should use a more detailed query"

const TOOL_DESCRIPTIONS = [{
  type: 'function',
  function: {
    name: 'search_wikipedia',
    description: 'Search for information on Wikipedia.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query for Wikipedia'
        }
      },
      required: [
        'query'
      ]
    }
  }
}, {
  type: 'function',
  function: {
    name: 'get_current_time',
    description: 'Get the current time. This function has no additional arguments',
    properties: {},
    required: []
  }
}, {
  type: 'function',
  function: {
    name: 'delegate_task',
    description: 'Ask a more focused assistant to think about something and respond to you. Use this when breaking tasks down to stay focused.',
    properties: {
      task: {
        type: 'string',
        description: 'The task you want performed. Be as verbose as you can and include all relevant information.'
      }
    }
  },
  required: ['task']
}]

const SYSTEM_PROMPT = `
You are a function calling AI agent used for automating data retrieval and analysis tasks.
You can call only one function at a time and analyse data you get from the function response.
Before calling a function, think step by step in plain language.
Keep going until you solve the user's query.
Don't assume usernames or emails or api keys and ask the user for them or retrieve them from memory.
Here are the available tools:
<tools>${JSON.stringify(TOOL_DESCRIPTIONS)}</tools>
For each function call return a json object with function name and arguments within <tool_call></tool_call> XML tags as follows:
<tool_call>
{"arguments": <args-dict>, "name": <function-name>}
</tool_call>
`

/*
Use the following pydantic model json schema for each tool call you will make:
{"properties": {"arguments": {"title": "Arguments", "type": "object"}, "name": {"title": "Name", "type": "string"}}, "required": ["arguments", "name"], "title": "FunctionCall", "type": "object"}
For each function call return a json object with function name and arguments within <tool_call></tool_call> XML tags as follows:
<tool_call>
{"arguments": <args-dict>, "name": <function-name>}
</tool_call>
*/

const rl = readline.createInterface({ input, output })

while (true) {
  const question = await rl.question('> ')
  const response = await query(question)
  console.log(response)
}

async function query (prompt) {
  const messages = [{
    role: SYSTEM,
    content: SYSTEM_PROMPT
  }, {
    role: USER,
    content: prompt
  }]
  let answer = (await genAnswer(messages)).trim()

  // If it tries to call multiple tools, ignore the last ones.
  while (answer.indexOf(TOOL_CALL_START) !== answer.lastIndexOf(TOOL_CALL_START)) {
    answer = answer.slice(0, answer.lastIndexOf(TOOL_CALL_START))
  }

  // TODO: Handle multi calls
  while (answer.includes(TOOL_CALL_START)) {
    const description = answer.slice(
      answer.indexOf(TOOL_CALL_START) + TOOL_CALL_START.length,
      answer.indexOf(TOOL_CALL_END)
    )
    const { name, arguments: args } = JSON.parse(description)

    if (!(name in FUNCTIONS)) {
      messages.push({
        role: ASSISTANT,
        content: answer
      }, {
        role: TOOL,
        content: `<tool_response>
Error: Function "${name}" does not exist.
Try something else or ask the user for help.
Don't tell the user about the error unless absolutely necessary.
Solve this mistake by thinking step by step.
</tool_response>`
      })
    } else {
      console.log(`(( calling ${name}${JSON.stringify(args)} ))`)

      const response = await FUNCTIONS[name](args)

      messages.push({
        role: ASSISTANT,
        content: answer
      }, {
        role: TOOL,
        content: `<tool_response>\n${JSON.stringify(response)}\n</tool_response>`
      })
    }

    console.log(messages)

    const final = await genAnswer(messages)

    answer = final.trim()
  }

  return answer
}

function makeConvo (messages) {
  return messages.map(({ role, content }) => `<|im_start|>${role}\n${content}<|im_end|>`).join('\n')
}

async function genAnswer (messages) {
  const prompt = makeConvo(messages) + PRE_GENERATE
  // console.log({prompt})
  const response = await await fetch('http://127.0.0.1:8080/completion', {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      stop: STOP,
      n_predict: 1024,
      temperature: 0.8,
      top_p: 0.9
    })
  })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  const { content } = await response.json()

  return content
}

function delegateTask ({ task }) {
  return query(`Greetings!
You have been delegated the following task from another AI assistant.
${task}
You are allowed to make a guess to accomplish this task if you don't have appropriate functions to call.
Don't delegate this task any further unless you have a specific sub-task to delegate.
`)
}

function getCurrentTime () {
  return new Date().toString()
}

async function searchWikipedia ({ query }) {
  const url = new URL('https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&limit=1')
  url.searchParams.set('srsearch', query)
  const response = await fetch(url.href)
  try {
    const results = await response.json()
    const snippet = striptags(results.query.search[0].snippet)
    return snippet
  } catch (e) {
    return e.message
  }
}
