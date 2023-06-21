import React, { useState, useEffect, useRef } from "react";
import {
  log,
  logWithComponent,
  getObjectDifference,
  hasOnlyResponseKey,
  setNestedProperties,
  deepMerge,
  checkConflicts,
} from "../utils/utils";
import useUpdateTask from "../hooks/useUpdateTask";
import useStartTask from "../hooks/useStartTask";
import useNextTask from "../hooks/useNextTask";
import withDebug from "./withDebug";
import _ from "lodash";
import useUpdateWSFilter from "../hooks/useUpdateWSFilter";
import useStartWSFilter from "../hooks/useStartWSFilter";
import useNextWSFilter from "../hooks/useNextWSFilter";
import useErrorWSFilter from "../hooks/useErrorWSFilter";
import useGlobalStateContext from "../contexts/GlobalStateContext";
import useWebSocketContext from "../contexts/WebSocketContext";
import { useEventSource } from '../contexts/EventSourceContext';

// When a task is shared then changes are detected at each wrapper

function withTask(Component) {
  const WithDebugComponent = withDebug(Component);

  const componentName = WithDebugComponent.displayName; // So we get the Component that was wrapped by withDebug

  function TaskComponent(props) {

    const localStackPtrRef = useRef();
    if (typeof props.stackPtr === "number") {
      localStackPtrRef.current = props.stackPtr + 1;
    } else {
      //console.log("Defaulting to stackPtr 0")
      localStackPtrRef.current = 0;
    }

    const { globalState } = useGlobalStateContext();
    const [isMounted, setIsMounted] = useState();
    const [prevTask, setPrevTask] = useState();
    const [startTaskId, setStartTaskId] = useState();
    const [lastStartTaskId, setLastStartTaskId] = useState();
    const [startTaskThreadId, setStartTaskThreadId] = useState();
    const [childTask, setChildTask] = useState();
    const [startTaskDepth, setStartTaskDepth] = useState(localStackPtrRef.current);
    // By passing the stackPtr we know which layer is sending the task
    // Updates to the task might be visible in other layers
    // Could allow for things like changing config from an earlier component
    const { updateTaskError } = useUpdateTask(
      props.task,
      props.setTask,
      localStackPtrRef.current
    );
    const [nextTask, setNextTask] = useState();
    // Note we pass in doneTask in this way the nextWSFilter will match to the stackPtr level where doneTask was set
    const { nextTaskError } = useNextTask(
      props.task,
      props.setTask
    );
    const [startTaskReturned, setStartTaskReturned] = useState();
    const { startTaskError } = useStartTask(startTaskId, setStartTaskId, startTaskThreadId, startTaskDepth);
    const lastStateRef = useRef("");
    const { subscribe, unsubscribe, publish, initialized } = useEventSource();
    const [threadId, setThreadId] = useState();
    const publishedRef = useRef("");
    const [threadDiff, setThreadDiff] = useState();

    /*
    // Example of how to use the threadDiff
    // The child should enable this by modifyTask({"processor.config.threadDiff": true});
    useEffect(() => {
      if (!props?.task?.processor?.config?.threadDiff && props.task) {
        modifyTask({"processor.config.threadDiff": true});
      }
      if (threadDiff) {
        console.log('Received a task change in ' + props.task.id, threadDiff);
      }
    }, [threadDiff]); 
    */ 

    const handleTaskUpdate = (event) => {
      //console.log('Received a task change', event.detail);
      // Intended to monitor other tasks not itself
      if (event.detail.instanceId !== props.task.instanceId) {
        setThreadDiff(event.detail);
      }
    };

    // We publish diffs of Task as events to a threadId
    useEffect(() => {
      if (!threadId) {return;}
      if (initialized) {
        subscribe('taskChange-' + threadId, handleTaskUpdate);
      }
      // Unsubscribe when the component unmounts
      return () => {
        if (initialized) {
          unsubscribe('taskChange-' + threadId, handleTaskUpdate);
        }
      };
    }, [subscribe, unsubscribe, threadId]);

    useEffect(() => {
      // Only need one watcher per task, use the active stackPtr level
      if (threadId && localStackPtrRef.current === props.task.stackPtr) {
        let diff;
        if (prevTask && publishedRef.current) {
          diff = getObjectDifference(prevTask, props.task);
        } else {
          diff = props.task;
        }
        publish('taskChange-' + threadId, {taskdiff: diff, id: props.task.id, instanceId: props.task.instanceId, stackPtr: props.task.stackPtr});
        publishedRef.current = true;
      }
    }, [props.task]);

    useEffect(() => {
      if (!threadId && props.task && props.task.processor?.config?.threadDiff) {
        setThreadId(props.task.threadId);
      }
    }, [props.task]);

    const handleChildDidMount = () => {
      // This is called during the rendering of the Task and even though
      // this is a HoC w get warnings for changing state during rendering
      // So adding this delay will update outside of the rendering of Task
      setTimeout(() => setIsMounted(true), 0);
    }

    // React does not seem to gaurantee this is called in the parent before the child
    useEffect(() => {
      // Don't do this when stackPtr is 0 e.g. from taskflows.js where there is no props.task
      if (localStackPtrRef.current > 0) {
        const spawn = props.task.config?.spawn === false ? false : true;
        if (localStackPtrRef.current < props.stackTaskId.length && spawn) {
          let startTaskId = props.stackTaskId[localStackPtrRef.current]
          const newPtr = localStackPtrRef.current + 1;
          startTaskFn(startTaskId, props.task.threadId, newPtr);
          console.log("startTaskFn", startTaskId, newPtr)
        }
        //modifyTask(() => { return {stackPtr: Math.max(props.task.stackPtr, localStackPtrRef.current)} });
        //modifyTask({stackPtr: localStackPtrRef.current});
      }
    }, []);

    useEffect(() => {
      // Don't do this when stackPtr is 0 e.g. from taskflows.js where there is no props.task
      if (localStackPtrRef.current > 0) {
        const spawn = props.task.config?.spawn === false ? false : true;
        if (localStackPtrRef.current < props.stackTaskId.length && spawn) {
          if (startTaskReturned) {
            setChildTask(startTaskReturned)
            console.log("setChildTask", startTaskReturned.id)
          }
        }
      }
    }, [startTaskReturned]);

    useUpdateWSFilter(isMounted, localStackPtrRef, props.task,
      async (updateDiff) => {
        //console.log("useUpdateWSFilter updateDiff.stackPtr === localStackPtrRef", updateDiff.stackPtr, localStackPtrRef.current);
        if (updateDiff.stackPtr === localStackPtrRef.current) {
          const lastTask = await globalState.storageRef.current.get(props.task.instanceId);
          //console.log("Storage get ", props.task.id, props.task.instanceId, lastTask);
          //console.log("lastTask", lastTask)
          // If the resource has been locked then ignore whatever was done locally
          let currentTaskDiff = {};
          if (lastTask.locked === globalState.processorId) {
            currentTaskDiff = getObjectDifference(lastTask, props.task);
          }
          //console.log("currentTaskDiff", currentTaskDiff);
          //console.log("updateDiff", updateDiff);
          //const currentUpdateDiff = getObjectDifference(currentTaskDiff, updateDiff);
          //console.log("currentUpdateDiff", currentUpdateDiff);
          // ignore differences in source & updatedAt & lock
          delete currentTaskDiff.source
          delete currentTaskDiff.updatedAt
          delete currentTaskDiff.lock
          // partial updates to response can cause conflicts
          // Needs further thought
          delete currentTaskDiff.response
          if (lastTask.locked === globalState.processorId) {
            // Priority to local changes
            delete updateDiff.update;
          }
          if (checkConflicts(currentTaskDiff, updateDiff)) {
            console.error("CONFLICT currentTaskDiff, updateDiff ", currentTaskDiff, updateDiff);
            //throw new Error("CONFLICT");
          }
          modifyTask(updateDiff);
          // Important we record updateDiff as it was sent to keep in sync with Hub
          await globalState.storageRef.current.set(props.task.instanceId, deepMerge(lastTask, updateDiff));
          const newTask = await globalState.storageRef.current.get(props.task.instanceId);
          console.log("Storage update ", props.task.id, props.task.instanceId, updateDiff);
          //console.log("Storage task ", props.task.id, props.task.instanceId, mergedTask);
        }
      }
    )

    useStartWSFilter(useGlobalStateContext, lastStartTaskId,
      (newTask) => {
        console.log("useStartWSFilter", newTask);
        setLastStartTaskId(null);
        setStartTaskReturned(newTask)
      }
    )

    useNextWSFilter(useGlobalStateContext, localStackPtrRef, props.task,
      (updatedTask) => {
        console.log("useNextWSFilter before setNextTask localStackPtrRef.current", localStackPtrRef.current, updatedTask);
          //console.log("useNextWSFilter setNextTask localStackPtrRef.current", localStackPtrRef.current);
          setNextTask(updatedTask)
        //}
      }
    )
    
    useErrorWSFilter(props.task?.threadId,
      (updatedTask) => {
        console.log("useErrorWSFilter", updatedTask.id, updatedTask.response.text);
        // We do not have a plan for dealing with errors here yet
        // Currently an error task is returned so it can work if 
        // we are waiting on useStartWSFilter or useNextWSFilter
        // update will not see the error Task because the instanceId is different
      }
    )

    function startTaskFn(
      startId,
      threadId = null,
      depth = null
    ) {
      setStartTaskId(startId);
      setLastStartTaskId(startId); // used by the useStartWSFilter
      setStartTaskThreadId(threadId);
      setStartTaskDepth(depth);
    }

    // Manage the last state with a ref because we can't gaurantee when the task.state.last will be updated
    // This issp ecific to how React handles setState 
    function modifyState(state) {
      //console.log("modifyState", state, props.task.state.current, props.task.state.last, lastStateRef.current);
      lastStateRef.current = props.task.state.current;
      if (state) {
        props.setTask((p) =>
          deepMerge(
            p,
            setNestedProperties({
              "state.current": state,
              "state.last": p.state.current,
            })
          )
        );
      } else if (props.task.state.current != props.task.state.last) {
        props.setTask(p => ({...p, state: {...p.state, last: p.state.current}}))
      }
    }

    useEffect(() => {
      if (startTaskError) {
        log("startTaskError", startTaskError);
      }
      if (nextTaskError) {
        log("nextTaskError", nextTaskError);
      }
      if (updateTaskError) {
        log("updateTaskError", updateTaskError);
      }
    }, [startTaskError, nextTaskError, updateTaskError]);

    useEffect(() => {
      const { task } = props;
      if (task && task.stackPtr === localStackPtrRef.current) {
        setPrevTask(task);
      }
    }, []);

    useEffect(() => {
      const { task } = props;
      if (task && task.stackPtr === localStackPtrRef.current) {
        if (prevTask !== task) {
          setPrevTask(props.task);
        }
      }
    }, [props.task]);

    function modifyTask(update) {
      setNestedProperties(update);
      //console.log("modifyTask", props.task)
      props.setTask((prevState) => {
        const res = deepMerge(prevState, update);
        return res;
      });
    }

    // Check for a command and clear it if it is set
    function isCommand(command) {
      if (props.task.command === command) {
        props.setTask((prevState) => ({...prevState, command: null}));
        return true;
      } else {
        return false;
      }
    }

    useEffect(() => {
      const c = props?.task?.command;
      const pc = prevTask?.command;
      if (c && pc && c !== pc) {
        throw new Error("Unexpected command change " + c + " " + pc);
      }
    }, [props.task]);  

    function useTaskState(initialValue, name = "task") {
      const [state, setState] = useState(initialValue);
      const [prevTaskState, setPrevTaskState] = useState({});

      useEffect(() => {
        if (!state) {
          return;
        }
        let diff;
        if (prevTaskState) {
          diff = getObjectDifference(prevTaskState, state);
        } else {
          diff = state;
        }
        let show_diff = true;
        if (hasOnlyResponseKey(diff)) {
          if (!prevTaskState.response?.text) {
            diff.response["text"] = "...";
          } else {
            show_diff = false;
          }
        }
        if (!state.id) {
          console.log("Unexpected: Task without id ", state);
        }
        if (show_diff && Object.keys(diff).length > 0) {
          if (state.stackPtr === localStackPtrRef.current) {
            logWithComponent(
              componentName,
              name + " " + state.id + " changes:",
              diff
            );
          }
        }
        setPrevTaskState(state);
      }, [state, prevTaskState]);

      const setTaskState = (newState) => {
        if (typeof newState === "function") {
          setState((prevState) => {
            const updatedState = newState(prevState);
            return updatedState;
          });
        } else {
          setState(newState);
        }
      };
      return [state, setTaskState];
    }

    // This is not working for debug
    function useTasksState(initialValue, name = "tasks") {
      const [states, setStates] = useState(initialValue);
      const [prevTasksState, setPrevTasksState] = useState([]);

      useEffect(() => {
        if (!states) {
          return;
        }
        for (let i = 0; i < states.length; i++) {
          const state = states[i];
          const prevTaskState = prevTasksState[i];
          let diff;
          if (prevTaskState) {
            diff = getObjectDifference(prevTaskState, state);
          } else {
            diff = state;
          }
          let show_diff = true;
          if (hasOnlyResponseKey(diff)) {
            if (!prevTaskState.response?.text) {
              diff.response["text"] = "...";
            } else {
              show_diff = false;
            }
          }
          if (!state?.id) {
            console.log("Unexpected: Task without id ", state);
          }
          if (show_diff && Object.keys(diff).length > 0) {
            if (state.stackPtr === localStackPtrRef.current) {
              logWithComponent(
                componentName,
                name + " " + state.id + " changes:",
                diff
              );
            }
          }
        }
        setPrevTasksState(states);
      }, [states, prevTasksState]);

      const setTasksState = (newStates) => {
        if (typeof newStates === "function") {
          setStates((prevStates) => {
            const updatedStates = newStates(prevStates);
            return updatedStates;
          });
        } else {
          setStates(newStates);
        }
      };

      return [states, setTasksState];
    }

    const transitionTo = (state) => {
      return (props.task.state.current === state && lastStateRef.current !== state)
    };
  
    const transitionFrom = (state) => {
      return (props.task.state.current !== state && lastStateRef.current === state)
    };
  
    const transition = () => {
      //console.log("transition", props.task.state.current, lastStateRef.current)
      return (props.task.state.current !== lastStateRef.current)
    };

    // Tracing
    useEffect(() => {
      //console.log("Tracing prevTask ", prevTask)
    }, [prevTask]);

    const componentProps = {
      ...props,
      task: props.task,
      setTask: props.setTask,
      updateTaskError,
      startTaskError,
      startTask: startTaskReturned,
      startTaskFn,
      nextTaskError,
      nextTask,
      prevTask,
      modifyTask,
      modifyState,
      stackPtr: localStackPtrRef.current,
      useTaskState,
      useTasksState,
      processorId: globalState.processorId,
      transition,
      transitionTo,
      transitionFrom,
      user: globalState.user,
      onDidMount: handleChildDidMount,
      useWebSocketContext,
      componentName: props?.task?.stack[localStackPtrRef.current - 1],
      childTask,
      setChildTask,
      isCommand,
      handleTaskUpdate,
      threadDiff,
    };

    return <WithDebugComponent {...componentProps} />;
  }

  TaskComponent.displayName = componentName;
  return TaskComponent;
}

export default withTask;
