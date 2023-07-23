/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
*/

"use strict";
import { v4 as uuidv4 } from "uuid";
import { MAP_USER, DEFAULT_USER } from "../config.mjs";
import { deepMerge, getObjectDifference, flattenObjects, updatedAt, djb2Hash, taskHash } from "./shared/utils.mjs";

const utils = {};

// Shared utils functions
utils.deepMerge = deepMerge;
utils.getObjectDifference = getObjectDifference;
utils.flattenObjects = flattenObjects;
utils.updatedAt = updatedAt;
utils.djb2Hash = djb2Hash;
utils.taskHash = taskHash;

utils.getUserId = function (req) {
  let userId = DEFAULT_USER;
  let sourceIP = req.ip;
  if (sourceIP.startsWith('::ffff:')) {
    sourceIP = sourceIP.substring('::ffff:'.length);
  }
  // If the request is from localhost then no need to authenticate
  if (sourceIP === "127.0.0.1") {
    if (req.body.userId) {
      userId = req.body.userId;
    }
  } else if (process.env.AUTHENTICATION === "basic") { // untested
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const encodedCredentials = authHeader.split(' ')[1];
      const decodedCredentials = Buffer.from(encodedCredentials, 'base64').toString();
      const [username, password] = decodedCredentials.split(':');
      userId = username;
    }
    //userId = req.headers["x-authenticated-userid"]; // unsure if this works
  } else if (process.env.AUTHENTICATION === "cloudflare") {
    userId = req.headers["cf-access-authenticated-user-email"];
  }
  if (MAP_USER && MAP_USER[userId]) {
    userId = MAP_USER[userId];
  }
  return userId;
};

utils.formatDateAndTime = function (date) {
  const options = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  return new Intl.DateTimeFormat("fr-FR", options).format(date);
};

utils.load_data_async = async function (config_dir, name) {
  let result = {};
  try {
    result = (await import(config_dir + "/" + name + ".mjs"))[name];
    //console.log("Importing data " + config_dir + '/' + name + ".mjs ")
  } catch (error) {
    console.log(
      "No " + name + " at " + config_dir + "/" + name + ".mjs " + error
    );
  }
  return result;
};

utils.findSubObjectWithKeyValue = function (obj, targetKey, targetValue) {
  if (typeof obj !== "object" || obj === null) {
    return null;
  }
  if (obj[targetKey] === targetValue) {
    return obj;
  }
  for (const key in obj) {
    const result = utils.findSubObjectWithKeyValue(
      obj[key],
      targetKey,
      targetValue
    );
    if (result !== null) {
      return result;
    }
  }
  return null;
};

utils.regexProcessMessages_async = async function (
  messages,
  messageStore_async,
  initialLastMessageId = null
) {
  let lastMessageId = initialLastMessageId;

  for (const message of messages) {
    const id = uuidv4();
    const chatMessage = {
      role: message.role,
      user: message?.user,
      id: id,
      parentMessageId: lastMessageId,
      text: message.content,
    };

    if (message.role === "system") {
      error("Not expecting system message here");
    } else {
      await messageStore_async.set(id, chatMessage);
    }

    lastMessageId = id;
  }
  return lastMessageId;
};

utils.messagesText_async = async function (messageStore_async, LastMessageId) {
  let id = LastMessageId;
  let text = "";
  let message;
  while ((message = await messageStore_async.get(id))) {
    text = message.text + text; // prepend
    id = message.parentMessageId;
  }
  return text;
};

utils.filter_in_list = function (task, filter_list) {
  const taskCopy = { ...task }; // or const objCopy = Object.assign({}, obj);
  for (const key in taskCopy) {
    if (!filter_list.includes(key)) {
      delete taskCopy[key];
    }
  }
  return taskCopy;
};

utils.filter_in = function (tasktypes, tasks, task) {
  if (!task?.id) {
    console.log("ERROR Task has no id ", task);
  }
  //console.log("BEFORE ", task)
  let filter_list = [];
  let filter_for_react = [];
  if (task?.filter_for_react) {
    filter_list = filter_list.concat(task.filter_for_react);
    filter_for_react = filter_for_react.concat(task.filter_for_react);
  }
  filter_list = Array.from(new Set(filter_list)); // uniquify
  filter_for_react = Array.from(new Set(filter_for_react)); // uniquify
  if (filter_list.length < 1) {
    console.log("Warning: the task ", task, " is missing filter");
  }
  const taskCopy = { ...task }; // or const objCopy = Object.assign({}, obj);
  for (const key in taskCopy) {
    if (!filter_list.includes(key)) {
      delete taskCopy[key];
      if (
        !filter_for_react.includes(key) &&
        !key.startsWith("APPEND_") &&
        !key.startsWith("PREPEND_")
      ) {
        console.log(
          "Warning: Unknown task key not returned to React Task Processor " +
            key +
            " in task id " +
            task.id
        );
      }
    }
  }
  //console.log("AFTER ", filter_list, taskCopy)
  return taskCopy;
};

utils.authenticatedTask = function (task, userId, groups) {
  let authenticated = false;
  if (task?.permissions) {
    task.permissions.forEach((group_name) => {
      if (!groups[group_name]?.users) {
        console.log("Group " + group_name + " has no users", groups[group_name]);
      } else if (groups[group_name].users.includes(userId)) {
        authenticated = true;
      }
    });
  } else {
    authenticated = true;
  }
  //console.log("Authenticated " + task.id + " " + userId + " " + authenticated);
  return authenticated;
};

utils.capitalizeFirstLetter = function (str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

utils.getNestedValue = function (obj, path) {
  return path.split(".").reduce((prev, curr) => {
    return prev && prev[curr] !== undefined ? prev[curr] : undefined;
  }, obj);
};

utils.setNestedValue = function (obj, path, value) {
  const pathArray = path.split(".");
  const lastKey = pathArray.pop();
  const target = pathArray.reduce((prev, curr) => {
    return (prev[curr] = prev[curr] || {});
  }, obj);

  target[lastKey] = value;
};

utils.createTaskValueGetter = function(task) {
  return function (path, value) {
    if (arguments.length === 2) {
      utils.setNestedValue(task, path, value);
      //console.log("createTaskValueGetter set ",path,value)
    } else {
      const res = utils.getNestedValue(task, path);
      //console.log("createTaskValueGetter get ", path, res)
      return res;
    }
  };
};

// Adding key of object as id in object
utils.add_index = function(config) {
  for (const key in config) {
    if (config.hasOwnProperty(key)) {
      config[key]["id"] = key;
    }
  }
}


export { utils };
