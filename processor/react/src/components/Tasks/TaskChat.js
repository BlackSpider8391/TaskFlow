/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
*/

import React, { useCallback, useState, useRef, useEffect } from "react";
import withTask from "../../hoc/withTask";
import usePartialWSFilter from "../../hooks/usePartialWSFilter";
import { parseRegexString } from "../../utils/utils";
import PromptDropdown from "./TaskChat/PromptDropdown";
import send from "../../assets/send.svg";

/*
Task Process
  Present textarea and dropdown for user to enter a prompt
  When prompt is submitted state.current -> sending
  NodeJS sends incemental text responses by websocket updating task.response.text
  NodeJS sends final text and terminates HTTP request with state.current=input
  Parent component is expected to:
    Display updates to task.output.msgs

Task States
  input: get user prompt
  sending: sending user prmopt to NodeJS Task Processor
  receiving: receiving websocket response from NodeJS Task Processor
  
ToDo:
  Allow copy/paste while receiving
    To allow this we need to append dom elements. 
    In chatGPT they have the same problem inside the active <p> 
    but once rendered the <p></p> can be copied
  Max width for suggested prompts with wrapping possible?
*/

const TaskChat = (props) => {
  const {
    log,
    task,
    modifyTask,
    transition,
    transitionTo, 
    transitionFrom, 
    user,
    onDidMount,
    componentName,
  } = props;

  const [submitForm, setSubmitForm] = useState(false);
  const [responseText, setResponseText] = useState("");
  const responseTextRef = useRef("");
  const textareaRef = useRef();
  const formRef = useRef();
  const [socketResponses, setSocketResponses] = useState([]);

  // onDidMount so any initial conditions can be established before updates arrive
  onDidMount();

  // Note that socketResponses may not (will not) be updated on every websocket event
  // React groups setState operations and I have not understood the exact criteria for this
  useEffect(() => {
    const processResponses = () => {
      setSocketResponses((prevResponses) => {
        //console.log("prevResponses.length", prevResponses.length);
        for (const response of prevResponses) {
          const text = response.partial.text;
          const mode = response.partial.mode;
          switch (mode) {
            case 'delta':
              responseTextRef.current += text;
              break;
            case 'partial':
            case 'final':
              responseTextRef.current = text;
              break;
          }
        }
        //console.log("TaskChat processResponses responseTextRef.current:", responseTextRef.current);
        setResponseText(responseTextRef.current);
        return []; // Clear the processed socketResponses
      });
    };
    if (socketResponses.length > 0) {
      processResponses();
    }
  }, [socketResponses]);

  // I guess the websocket can cause events during rendering
  // Putting this in the HoC causes a warning about setting state during rendering
  usePartialWSFilter(task,
    (partialTask) => {
      //console.log("TaskChat usePartialWSFilter partialTask", partialTask.response);
      setSocketResponses((prevResponses) => [...prevResponses, partialTask.response]);
    }
  )

  // Task state machine
  // Need to be careful setting task in the state machine so it does not loop
  // Could add a check for this
  useEffect(() => {
    if (!props.checkIfStateReady()) {return}
    let nextState;
    if (transition()) { log("TaskChat State Machine State " + task.state.current,task) }
    // Deep copy because we are going to modify the msgs array which is part of a React state
    // so it should only be modified with modifyTask
    const msgs = task.output?.msgs ? JSON.parse(JSON.stringify(task.output.msgs)) : [];
    switch (task.state.current) {
      case "start":
      case "input":
        if (transitionFrom("received")) {
          responseTextRef.current = "";
          setResponseText(responseTextRef.current);
        }
        if (task.input.submitForm) {
          nextState = "sending";
        }
        if (task.state?.address && task.state?.lastAddress !== task.state.address) {
          nextState = "mentionAddress";
        }
        break;
      case "mentionAddress":
        if (transitionTo("mentionAddress")) {
          // Add the input too for the user
          const promptText = "Location: " + task.state?.address;
          // Lock task so users cannot send at same time. NodeJS will unlock on final response.
          modifyTask({ 
            "output.prompt": { role: "user", text: promptText, user: user.label },
            "output.promptResponse": { role: "assistant", text: "", user: "assistant" },
            "commandArgs": { "lock": true },
            "command": "update",
            "state.lastAddress": task.state.address,
            "input.prompt": prompt,
          });
        }
        break;
      case "sending":
        if (transitionTo("sending") && !task.meta?.locked) {
          // Lock task so users cannot send at same time. NodeJS will unlock on final response.
          modifyTask({ 
            "output.prompt": { role: "user", text: task.input.prompt, user: user.label },
            "output.promptResponse": { role: "assistant", text: "", user: "assistant" },
            "output.sending": true,
            "commandArgs": { "lock": true },
            "command": "update",
            "input.submitForm": false,
          });
        }
        break;
      case "receiving":
        if (transitionTo("receiving")) {
          modifyTask({
            "input.prompt": "",
            "output.sending": false,
            "output.prompt": null,
            "output.msgs": [...msgs, task.output.prompt],
          }); // Not so good for collaborative interface 
        }
        const promptResponse = task.output.promptResponse;
        // Avoid looping due to modifyTask by checking if the text has changed
        if (responseText && responseText !== promptResponse.text) {
          promptResponse.text = responseText;
          //console.log("modifyTask")
          modifyTask({
            "output.promptResponse": promptResponse,
          });
        }
        break;
      case "received":
        nextState = "input";
        modifyTask({
          "output.promptResponse": null,
          "output.msgs": [...msgs, task.output.promptResponse],
        });
        break;
    }
    // Manage state.current and state.last
    props.modifyState(nextState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, responseText]);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      if (task?.input?.prompt) {
        modifyTask({
          "input.submitForm": true,
        });
      }
    },
    [task?.input?.prompt]
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
    textarea.placeholder = task?.config?.promptPlaceholder;
  }, [task?.input?.prompt, task?.config?.promptPlaceholder]);

  const handleDropdownSelect = (selectedPrompt) => {
    // Prepend to existing prompt, might be better just to replace
    modifyTask({"input.prompt": selectedPrompt + task.input.prompt});
    setSubmitForm(true);
  }

  // Allow programmatic submission of the form 
  // Set submitForm to true to submit
  // Maybe events would be better
  useEffect(() => {
    if (!submitForm) {
      const formNode = formRef.current;
      if (formNode) {
        formNode.requestSubmit();
      }
    }
  }, [submitForm]);

  function processMessages(text) {
    const regexProcessMessages = task.config.regexProcessMessages;
    if (regexProcessMessages) {
      for (const [regexStr, replacement] of regexProcessMessages) {
        let { pattern, flags } = parseRegexString(regexStr);
        const regex = new RegExp(pattern, flags);
        text = text.replace(regex, replacement);
      }
    }
    return text;
  }


  const sendReady = (!task || task.state.current === "sending") ? "not-ready" : "ready"

  return (
    <form onSubmit={handleSubmit} ref={formRef} className="msg-form">
      {task && task.config?.suggestedPrompts ? (
        <div style={{ textAlign: "left" }}>
          <PromptDropdown
            prompts={task.config.suggestedPrompts}
            onSelect={handleDropdownSelect}
          />
        </div>
      ) : (
        ""
      )}
      <div className="msg-textarea-button">
        <textarea
          ref={textareaRef}
          name="prompt"
          value={processMessages(task.input.prompt)}
          rows="1"
          cols="1"
          onChange={(e) => {
            modifyTask({"input.prompt": e.target.value});
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.shiftKey === false) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <button
          type="submit"
          disabled={sendReady === "not-ready"}
          className={"send-button " + sendReady}
        >
          {/* The key stops React double loading the image */}
          <img
            key={send}
            src={send}
            className={"send-" + sendReady}
          />
        </button>
      </div>
    </form>
  );
};

export default withTask(TaskChat);
