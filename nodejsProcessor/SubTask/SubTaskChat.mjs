/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
*/

import { encode } from "gpt-3-encoder";
import { ChatGPTAPI } from "chatgpt";
import { utils } from "../src/utils.mjs";
import { DUMMY_OPENAI, CACHE_ENABLE } from "../config.mjs";
import { users, agents, defaults } from "../src/configdata.mjs";
import {
  messagesStore_async,
  cacheStore_async,
  connections,
} from "../src/storage.mjs";
import { wsSendObject } from "../src/websocket.js";
import * as dotenv from "dotenv";
dotenv.config();

function SendIncrementalWs(partialResponse, instanceId, sessionId) {
  const incr = JSON.stringify(partialResponse.delta); // check if we can send this
  let ws = connections.get(sessionId);
  if (ws) {
    let response;
    if (ws.data["delta_count"] === undefined) {
      ws.data["delta_count"] = 0;
    }
    if (ws.data["delta_count"] && ws.data["delta_count"] % 20 === 0) {
      response = { text: partialResponse.text, mode: "partial" };
    } else if (incr) {
      response = { text: partialResponse.delta, mode: "delta" };
    }
    if (response) {
      const partialTask = {
        partialTask: { instanceId: instanceId, response: response },
      };
      wsSendObject(sessionId, partialTask);
      ws.data["delta_count"] += 1;
    }
    //console.log("ws.data['delta_count'] " + ws.data['delta_count'])
  } else {
    console.log(
      "Lost websocket in SendIncrementalWs for instanceId " + instanceId
    );
  }
}

async function SubTaskChat_async(task) {
  const params = await chat_prepare_async(task);
  const res = ChatGPTAPI_request_async(params);
  task.response.text_promise = res;
  return task
}

// Prepare the paramters for the chat API request
// Nothing specific to a partiuclar chat API
// Also using connections, defaults, agents, messagesStore_async, users
async function chat_prepare_async(task) {
  const T = utils.createTaskValueGetter(task);

  const sessionId = T("config.sessionId");
  let ws = connections.get(sessionId);
  if (!ws) {
    console.log("Warning: SubTaskChat_async could not find ws for " + sessionId);
  }
  let systemMessage = "";
  let lastMessageId = null;
  let initializing = false;
  let use_cache = CACHE_ENABLE;
  let server_only = false;

  let langModel = T("request.model") || defaults.langModel;
  let temperature = T("request.temperature") || defaults.temperature;
  let maxTokens = T("request.maxTokens") || defaults.maxTokens;
  let maxResponseTokens = T("request.maxResponseTokens") || defaults.maxResponseTokens;

  let prompt = T("request.prompt");
  let agent = agents[T("request.agent")];
  if (!agent) {
    console.log("No agent for ", task);
  }
  //console.log("Agent ", agent)

  if (T("config.oneThread")) {
    // Prefix with location when it has changed
    if (T("request.newAddress")) {
      prompt = "Location: " + T("request.address") + "\n" + prompt;
    }
    // Prefix prompt with date/time
    const currentDate = new Date();
    prompt = "Time: " + utils.formatDateAndTime(currentDate) + "\n" + prompt;
    console.log("oneThread prompt : " + prompt);
  }

  if (T("request.use_cache")) {
    use_cache = T("request.use_cache");
    console.log("Task set cache " + use_cache);
  }

  if (typeof agent?.prepend_prompt !== "undefined") {
    prompt = agent.prepend_prompt + prompt;
    console.log("Prepend agent prompt " + agent.prepend_prompt);
  }

  if (typeof agent?.append_prompt !== "undefined") {
    prompt += agent.append_prompt;
    console.log("Append agent prompt " + agent.append_prompt);
  }

  if (T("config.server_only")) {
    server_only = T("config.server_only");
    console.log("Task server_only");
  }

  if (agent?.forget) {
    initializing = true;
    console.log("Agent forget previous messages");
  }

  if (T("request.forget")) {
    initializing = true;
    console.log("Task forget previous messages", T("request.forget"));
  }

  if (!initializing) {
    lastMessageId = await messagesStore_async.get(
      T("threadId") + agent.id + "parentMessageId"
    );
    console.log(
      "!initializing T('threadId') " +
        T("threadId") +
        " lastMessageId " +
        lastMessageId
    );
  }

  if (!lastMessageId || initializing) {
    if (agent?.messages) {
      lastMessageId = await utils.processMessages_async(
        agent.messages,
        messagesStore_async,
        lastMessageId
      );
      console.log(
        "Initial messages from agent " + agent.name + " " + lastMessageId
      );
    }

    if (T("request.messages")) {
      lastMessageId = await utils.processMessages_async(
        T("request.messages"),
        messagesStore_async,
        lastMessageId
      );
      console.log(
        "Messages extended from name " +
          T("name") +
          " lastMessageId " +
          lastMessageId
      );
      //console.log(" T(request.messages)",  T("request.messages"))
    }
  }

  if (agent?.system_message) {
    systemMessage = agent.system_message;
    console.log("Sytem message from agent " + agent.name);
  }

  if (users[T("userId")] && T("request.dyad")) {
    let user = users[T("userId")];
    systemMessage += ` Vous etes en dyad avec votre user qui s'appelle ${user?.name}. ${user?.profile}`;
    console.log(
      "Dyad in progress between " + agent.name + " and " + user?.name
    );
  }

  // If we can have PREPEND and APPEND then we could replace T('request.dyad') with something general
  // This allows for user defined system messages
  if (T("request.system_message")) {
    systemMessage = T("request.system_message");
    console.log("Sytem message from task " + T("id"));
  }

  const threadId = T("threadId");
  const instanceId = T("instanceId");
  const agentId = agent.id;

  return {
    systemMessage,
    lastMessageId,
    server_only,
    prompt,
    use_cache,
    langModel,
    temperature,
    maxTokens,
    maxResponseTokens,
    agentId,
    threadId,
    instanceId,
    sessionId,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Build the parameters that are specific to ChatGPTAPI
// Manage cache
// Return response by websocket and return value
// Also using process.env.OPENAI_API_KEY, messagesStore_async, cacheStore_async, DUMMY_OPENAI
async function ChatGPTAPI_request_async(params) {
  const {
    systemMessage,
    lastMessageId,
    server_only,
    prompt,
    use_cache,
    langModel,
    temperature,
    maxTokens,
    agentId,
    threadId,
    instanceId,
    sessionId,
  } = params;

  let {
    maxResponseTokens,
  } = params;

  const debug = true;

  // Need to account for the system message and some margin because the token count may not be exact.
  //console.log("prompt " + prompt + " systemMessage " + systemMessage)
  if (!prompt) {
    console.log("ERROR: expect prompt to calculate tokens");
  }
  if (!systemMessage) {
    console.log(
      "Warning: expect systemMessage to calculate tokens unless vierge"
    );
  }
  const availableTokens =
    maxTokens -
    Math.floor(maxTokens * 0.1) -
    encode(prompt).length -
    encode(systemMessage).length;
  maxResponseTokens =
    availableTokens < maxResponseTokens ? availableTokens : maxResponseTokens;
  console.log(
    "Tokens maxTokens " + maxTokens + " maxResponseTokens " + maxResponseTokens
  );

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
    debug: debug,
  });

  const messageParams = {
    completionParams: {
      model: langModel,
      temperature: temperature,
    },
    parentMessageId: lastMessageId,
    systemMessage: systemMessage,
  };

  if (!server_only) {
    messageParams["onProgress"] = (partialResponse) =>
      SendIncrementalWs(partialResponse, instanceId, sessionId);
  }

  messagesStore_async.set(
    threadId + agentId + "systemMessage",
    messageParams.systemMessage
  );

  let cachedValue = "";
  let cacheKey = "";
  let cacheKeyText = {};
  if (use_cache) {
    const messagesText = await utils.messagesText_async(
      messagesStore_async,
      lastMessageId
    );
    cacheKeyText = [
      messageParams.systemMessage,
      messageParams.maxResponseTokens,
      messageParams.maxModelTokens,
      JSON.stringify(messageParams.completionParams),
      prompt,
      messagesText,
    ]
      .join("-")
      .replace(/\s+/g, "-");
    cacheKey = utils.djb2Hash(cacheKeyText);
    console.log("cacheKey " + cacheKey);
    cachedValue = await cacheStore_async.get(cacheKey);
  }

  // Message can be sent from one of multiple sources
  function message_from(source, text, server_only, sessionId, instanceId) {
    // Don't add ... when response is fully displayed
    console.log("Response from " + source + " : " + text.slice(0, 20) + " ...");
    const response = { text: text, mode: "final" };
    const partialTask = {
      partialTask: { instanceId: instanceId, response: response },
    };
    let ws = connections.get(sessionId);
    if (ws) {
      ws.data["delta_count"] = 0;
      if (!server_only) {
        wsSendObject(sessionId, partialTask);
      }
    } else {
      console.log("Lost ws in message_from");
    }
  }

  let response_text_promise = Promise.resolve("");

  if (cachedValue && cachedValue !== undefined) {
    messagesStore_async.set(
      threadId + agentId + "parentMessageId",
      cachedValue.id
    );
    let text = cachedValue.text;
    const words = text.split(" ");
    // call SendIncrementalWs for pairs of word
    let partialText = "";
    for (let i = 0; i < words.length; i += 2) {
      let delta = words[i] + " ";
      if (words[i + 1]) {
        delta += words[i + 1] + " ";
      }
      partialText += delta;
      const partialResponse = { delta: delta, text: partialText };
      SendIncrementalWs(partialResponse, instanceId, sessionId);
      await sleep(80);
    }
    message_from("cache", text, server_only, sessionId, instanceId);
    if (debug) {
      console.log("Debug: ", cacheKeyText);
    }
    response_text_promise = Promise.resolve(text);
  } else {
    // Need to return a promise
    if (DUMMY_OPENAI) {
      if (debug) {
        console.log("Debug: ", cacheKeyText);
      }
      const text = "Dummy text";
      message_from("Dummy API", text, server_only, sessionId, instanceId);
      response_text_promise = Promise.resolve(text);
    } else {
      response_text_promise = api
        .sendMessage(prompt, messageParams)
        .then((response) => {
          messagesStore_async.set(
            threadId + agentId + "parentMessageId",
            response.id
          );
          let text = response.text;
          message_from("API", text, server_only, sessionId, instanceId);
          if (use_cache) {
            cacheStore_async.set(cacheKey, response);
            console.log("cache stored key ", cacheKey);
          }
          return text;
        })
        .catch((error) => {
          let text = "ERROR " + error.message;
          message_from("API", text, server_only, sessionId);
          return text;
        });
    }
  }
  return response_text_promise;
}

export { SubTaskChat_async };
