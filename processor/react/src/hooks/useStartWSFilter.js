import { useEffect, useCallback, useState } from "react";
import { webSocketEventEmitter, messageQueue } from "../contexts/WebSocketContext";

function useStartWSFilter(useGlobalStateContext, initialTask, onStart) {
  
  const { globalState } = useGlobalStateContext();
  const [eventQueue, setEventQueue] = useState([]);
  const [working, setWorking] = useState(false);
  const [startTaskId, setStartTaskId] = useState();
  const [startPrevInstanceId, setStartPrevInstanceId] = useState();

  const startTaskDB = async (task) => {
    // We are not using this storage yet
    // We will need to clean it up
    if (globalState.storageRef) {
      globalState.storageRef.current.set(task.instanceId, task);
      //const value = await storageRef.current.get("a1");
      console.log("Storage start ", task.id, task.instanceId);
    } else {
      console.log("Storage not ready ", task.id, task.instanceId);
    }
  };

  const handleStart = async (taskStart) => {
    // messageQueue is an object not an array so we can delete from the object during iteration
    const keys = Object.keys(messageQueue);
    // sort the keyys so we process the oldest first
    keys.sort();
    //console.log("keys", keys);
    for (let key of keys) {
      const message = messageQueue[key];
      //console.log("message", message, key);
      if (message && message?.command && (message.command === "start" || message.command === "join")) {
        //console.log("message", message, key);
        //console.log("useStartWSFilter " + initialTask + " startTaskId " + startTaskId + " startPrevInstanceId " + startPrevInstanceId);
        if ((startTaskId && message.task.id === startTaskId) ||
            (startPrevInstanceId && message.task.meta.prevInstanceId === startPrevInstanceId)) {
          //console.log("useStartWSFilter startTaskId && message.task.id === startTaskId", startTaskId && message.task.id === startTaskId);
          //console.log("startPrevInstanceId && message.task.meta.prevInstanceId === startPrevInstanceId", startPrevInstanceId && message.task.meta.prevInstanceId === startPrevInstanceId)
          // Important to wait so that the task is saved to storage before it is retrieved again
          // We copy it so w can delete it ASAP
          const taskCopy = JSON.parse(JSON.stringify(message.task)); // deep copy
          delete messageQueue[key];
          startTaskDB(taskCopy);
          setStartTaskId(null);
          setStartPrevInstanceId(null);
          await onStart(taskCopy);
          //console.log("useStartWSFilter handleUpdate delete key", messageQueue);
        }
      }
    }
    //console.log("useStartWSFilter useEffect after messageQueue", messageQueue);
  };

  useEffect(() => {
    if (initialTask?.command === "start") {
      console.log("useStartWSFilter initialTask", initialTask);
      setStartTaskId(initialTask.commandArgs.id);
      setStartPrevInstanceId(initialTask.commandArgs.prevInstanceId || initialTask.instanceId);
    }
  }, [initialTask]);

  useEffect(() => {
    if (!webSocketEventEmitter) {
      return;
    }
    //console.log("useStartWSFilter useEffect adding handleStart startTaskId", startTaskId);
    webSocketEventEmitter.on("start", handleStart);
    webSocketEventEmitter.on("join", handleStart);
    return () => {
      //console.log("useStartWSFilter useEffect removing handleStart startTaskId", startTaskId);
      webSocketEventEmitter.removeListener("start", handleStart);
      webSocketEventEmitter.removeListener("join", handleStart);
    };
  }, [startTaskId]);
  
}

export default useStartWSFilter;
