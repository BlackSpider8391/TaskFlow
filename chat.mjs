import { encode } from 'gpt-3-encoder';
import { ChatGPTAPI } from 'chatgpt'
import { utils } from './utils.mjs';

//Using process.env.OPENAI_API_KEY

// Gobals:
// defaults
// agents
// messagesStore_async
// users
// cache_async
// DUMMY_OPENAI
// connections
// CACHE_ENABLE
// wsSendObject function
const initChatGlobals = (config) => {
  Object.assign(global, config);
}

function SendIncrementalWs(partialResponse, instanceId, ws) {
  const incr = JSON.stringify(partialResponse.delta)
  if (ws) {
    if (ws.data['delta_count'] && ws.data['delta_count'] % 20 === 0) {
      const message = {'instanceId' : instanceId, 'text' : partialResponse.text}
      wsSendObject(ws, message)
    } else if (incr) {
      const message = {'instanceId' : instanceId, 'delta' : partialResponse.delta}
      wsSendObject(ws, message)
    }
    ws.data['delta_count'] += 1
    //console.log("ws.data['delta_count'] " + ws.data['delta_count'])
  } else {
    console.log("Lost websocket in SendIncrementalWs for instanceId " + instanceId)
  }
}

async function chat_async(task) {
  const params = await chat_prepare(task)
  ChatGPTAPI_request(params)
}
  
// Prepare the paramters for the chat API request
// Nothing specific to a partiuclar chat API
// Also using connections, defaults, agents, messagesStore_async, users
async function chat_prepare(task) {

  const sessionId = task.sessionId
  let ws = connections.get(sessionId);
  if (!ws) {
    console.log("Warning: chat_async could not find ws for " + sessionId)
  }
  let systemMessage = ''
  let lastMessageId = null;
  let initializing = false;
  let use_cache = CACHE_ENABLE
  let server_task = false;

  let langModel = task?.model || defaults.langModel
  let temperature = task?.temperature || defaults.temperature
  let maxTokens = task?.maxTokens || defaults.maxTokens

  let prompt = task?.prompt
  let agent = agents[task.agent]

  if (task?.one_thread) {
    // Prefix with location when it has changed
    if (task?.new_address) {
      prompt = "Location: " + task.address + "\n" + prompt
    }
    // Prefix prompt with date/time
    const currentDate = new Date();
    prompt = 'Time: ' + utils.formatDateAndTime(currentDate) + "\n" + prompt
    console.log("one_thread prompt : " + prompt)
  }
  
  if (typeof task.use_cache !== 'undefined') {
    use_cache = task.use_cache
    console.log("Task set cache " + use_cache)
  }

  if (typeof agent?.prepend_prompt !== 'undefined') {
    prompt = agent.prepend_prompt + prompt
    console.log("Prepend agent prompt " + agent.prepend_prompt)
  }

  if (typeof agent?.append_prompt !== 'undefined') {
    prompt += agent.append_prompt
    console.log("Append agent prompt " + agent.append_prompt)
  }

  if (typeof task.initialize !== 'undefined') {
    initializing = task.initialize
    console.log("Task initializing")
  }

  if (typeof task.server_task !== 'undefined') {
    server_task = task.server_task
    console.log("Task server_task")
  }

  if (!initializing) {
    lastMessageId = await messagesStore_async.get(task.threadId + agent.id + 'parentMessageId')
    console.log("!initializing task.threadId " + lastMessageId)
  }

  if (!lastMessageId || initializing) {

    if (agent?.messages) {
      lastMessageId = await utils.processMessages_async(agent.messages, messagesStore_async, lastMessageId)
      console.log("Initial messages from agent " + agent.name + " " + lastMessageId)
    }

    if (task?.messages) {
      lastMessageId = await utils.processMessages_async(task.messages, messagesStore_async, lastMessageId)
      console.log("Messages extended from task.name " + task.name + " lastMessageId " + lastMessageId)
    }
  
    if (agent?.system_message) {
      systemMessage = agent.system_message;
      console.log("Sytem message from agent " + agent.name)
    }

    if (users[task.userId] && task.dyad) {
      let user = users[task.userId];
      systemMessage += ` Vous etes en dyad avec votre user qui s'appelle ${user?.name}. ${user?.profile}`;
      console.log("Dyad in progress between " + agent.name + " and " + user?.name)
    }

  }

  const threadId = task.threadId
  const instanceId = task.instanceId
  const agentId = agent.id

  return {
    systemMessage,
    lastMessageId,
    server_task,
    prompt,
    use_cache,
    langModel,
    temperature,
    maxTokens, 
    ws,
    agentId,
    threadId,
    instanceId,
  }

}
  
// Build the parameters that are specific to ChatGPTAPI
// Manage cache
// Return response by websocket and return value
// Also using process.env.OPENAI_API_KEY, messagesStore_async, cache_async, DUMMY_OPENAI
async function ChatGPTAPI_request(params) {
  
  const {
    systemMessage,
    lastMessageId,
    server_task,
    prompt,
    use_cache,
    langModel,
    temperature,
    maxTokens,
    ws,
    agentId,
    threadId,
    instanceId,
  } = params

  // Need to account for the system message and some margin because the token count may not be exact.
  //console.log("prompt " + prompt + " systemMessage " + systemMessage)
  if (!prompt) {console.log("ERROR: expect prompt to calculate tokens")}
  if (!systemMessage) {console.log("Warning: expect systemMessage to calculate tokens unless vierge")}
  const availableTokens = (maxTokens - Math.floor(maxTokens * 0.1)) - encode(prompt).length - encode(systemMessage).length
  let maxResponseTokens = 1000 // Leave room for conversation history
  maxResponseTokens = availableTokens < maxResponseTokens ? availableTokens : maxResponseTokens
  console.log("Tokens maxTokens " + maxTokens + " maxResponseTokens " + maxResponseTokens)
  
  // This is a hack to get parameters into the API
  // We should be able to change this on the fly, I requested a feature 
  // https://github.com/transitive-bullshit/chatgpt-api/issues/434
  const api = new ChatGPTAPI({
    apiKey: process.env.OPENAI_API_KEY,
    completionParams: {
      top_p: 1.0,
    },
    messageStore: messagesStore_async,
    maxResponseTokens: maxResponseTokens,
    maxModelTokens: maxTokens,
    debug: true
  })

  const messageParams = {
    completionParams: {
      model: langModel,
      temperature: temperature,
    },
    parentMessageId: lastMessageId,
    systemMessage: systemMessage,
  };

  if (!server_task) {
    messageParams['onProgress'] = (partialResponse) => SendIncrementalWs(partialResponse, instanceId, ws)
  }

  messagesStore_async.set(threadId + agentId + 'systemMessage', messageParams.systemMessage)

  let cachedValue = '';
  let cacheKey = '';
  if (use_cache) {
    const messagesText = await utils.messagesText_async(messagesStore_async, lastMessageId)
    const cacheKeyText = [
      messageParams.systemMessage,  
      JSON.stringify(messageParams.completionParams), 
      prompt, 
      messagesText
    ].join('-').replace(/\s+/g, '-')
    cacheKey = utils.djb2Hash(cacheKeyText);
    console.log("cacheKey " + cacheKey)
    cachedValue = await cache_async.get(cacheKey);
  }

  // Message can be sent from one of multiple sources
  function message_from(source, text, server_task, ws, instanceId) {
      // Don't add ... when response is fully displayed
    console.log("Response from " + source + " : " + text.slice(0, 20) + " ...");
    const message = {
      'instanceId' : instanceId,
      'final' : text
    }
    if (ws) {
      ws.data['delta_count'] = 0
      if (!server_task) { wsSendObject(ws, message) }
    } else {
      console.log("Lost ws in message_from")
    }
  }

  let response_text_promise = Promise.resolve("");

  if (cachedValue && cachedValue !== undefined) {
    messagesStore_async.set(threadId + agentId + 'parentMessageId', cachedValue.id)
    let text = cachedValue.text;
    message_from('cache', text, server_task, ws, instanceId)
    response_text_promise = Promise.resolve(text);
  } else {
    // Need to return a promise
    if (DUMMY_OPENAI) {
      const text = "Dummy text"
      message_from('Dummy API', text, server_task, ws, instanceId)
      response_text_promise = Promise.resolve(text);
    } else {
      response_text_promise = api.sendMessage(prompt, messageParams)
      .then(response => {
        messagesStore_async.set(threadId + agentId + 'parentMessageId', response.id)
        let text = response.text;
        message_from('API', text, server_task, ws, instanceId)    
        if (use_cache) {
          cache_async.set(cacheKey, response);
          console.log("cache stored key ", cacheKey);
        }
        return text
      })
      .catch(error => {
        let text = "ERROR " + error.message
        message_from('API', text, server_task, ws)    
        return text
      })
    } 
  }
  return response_text_promise
}

export { chat_async, initChatGlobals };