import React, { useState, useEffect } from 'react'
import { delta, logWithComponent, getObjectDifference, hasOnlyResponseKey } from '../utils/utils'
import useUpdateTask from '../hooks/useUpdateTask';
import useStartTask from '../hooks/useStartTask';
import useNextTask from '../hooks/useNextTask';
import { useWebSocketContext } from '../contexts/WebSocketContext';
import useFilteredWebSocket from '../hooks/useFilteredWebSocket';
import withDebug from './withDebug'
import _ from 'lodash';

// When a task is shared then changes are detected at each wrapper

function withTask(Component) {

  const WithDebugComponent = withDebug(Component);

  const componentName = WithDebugComponent.displayName // S owe get the Component that was wrapped by withDebug

  function TaskComponent(props) {

    let local_component_depth
    if (typeof props.component_depth === "number") {
      local_component_depth = props.component_depth + 1
    } else {
      //console.log("Defaulting to component_depth 0")
      local_component_depth = 0
    }

    const [prevTask, setPrevTask] = useState();
    const [doneTask, setDoneTask] = useState();
    const [startTaskId, setStartTaskId] = useState();
    const [startTaskThreadId, setStartTaskThreadId] = useState();
    const [startTaskDepth, setStartTaskDepth] = useState(local_component_depth);
    // By passing the component_depth we know which layer is sending the task
    // Updates to the task might be visible in other layers
    // Could allow for things like changing condif from an earlier component
    const { updateTaskLoading, updateTaskError } = useUpdateTask(props.task, props.setTask, local_component_depth);
    const { nextTask, nextTaskLoading, nextTaskError } = useNextTask(doneTask);
    const { webSocketEventEmitter } = useWebSocketContext();
    const { startTaskReturned, startTaskLoading, startTaskError } = useStartTask(startTaskId, startTaskThreadId, startTaskDepth);

    function startTaskFn(startId, threadId = null, depth = local_component_depth ) {
      setStartTaskId(startId)
      setStartTaskThreadId(threadId)
      setStartTaskDepth(depth)
    }
    
    function updateStep(step) {
      props.setTask(p => ({ ...p, step: step, last_step: p.step}))
      // Allow detection of new step
      delta(() => {
        props.setTask(p => ({ ...p, last_step: p.step }))
      })
    }

    useEffect(() => {
      const { task } = props;
      if (task && task.component_depth === local_component_depth) {
        setPrevTask(task);
      }
    }, []);

    useEffect(() => {
      const { task } = props;
      if (task && task.component_depth === local_component_depth) {
        if (prevTask !== task) {
            setPrevTask(props.task);
        } 
      }
    }, [props.task]);

    function updateTask(update) {
      props.setTask(prevState => ({ ...prevState, ...update }));
    }

    function useTaskWebSocket(callback) {
      useFilteredWebSocket(webSocketEventEmitter, props.task, callback)
    }

    // The order of component mounting in React is not gauranteed
    // So a lower component_depth could override the task if it is passed down
    // Should we pass down a copy of the task ?
    // But conversation is communicating through a shared task - maybe that is a problem
    // For now we pass the depth to useUpdateTask
    useEffect(() => {
      //console.log("local_component_depth " + local_component_depth)
      //props.setTask(p => ({ ...p, component_depth : local_component_depth }))
    }, []);

    function useTaskState(initialValue, name = "task") {
      const [state, setState] = useState(initialValue);
      const [prevTaskState, setPrevTaskState] = useState({});
    
      useEffect(() => {
        if (!state) {return}
        let diff
        if (prevTaskState) {
          diff = getObjectDifference(state, prevTaskState)
        } else {
          diff = state
        }
        let show_diff = true
        if (hasOnlyResponseKey(diff)) {
          if (!prevTaskState.response) {
            diff.response = "..."
          } else {
            show_diff = false
          }
        }
        if (show_diff && Object.keys(diff).length > 0) {
          logWithComponent(componentName, name + " " + props.task.id + " changes:", diff)
        }
        if (!props.task.id) {
          console.log("Unexpected: Task wihtout id ", props.task)
        }
        setPrevTaskState(state);
      }, [state, prevTaskState]);
    
      const setTaskState = (newState) => {
        if (typeof newState === 'function') {
          setState((prevState) => {
            const updatedState = newState(prevState);
            return updatedState;
          });
        } else {
          setState(newState);
        }
      }
    
      return [state, setTaskState]
    }
    
    // Tracing
    useEffect(() => {
      //console.log("Tracing prevTask ", prevTask)
    }, [prevTask]); 
  
    const componentProps = {
        ...props,
        updateTaskLoading, 
        updateTaskError,
        startTaskLoading,
        startTaskError,
        startTask : startTaskReturned,
        startTaskFn,
        nextTaskLoading,
        nextTaskError,
        nextTask,
        setDoneTask,
        prevTask,
        updateTask,
        updateStep, // add log as a prop
        webSocketEventEmitter,
        useTaskWebSocket,
        component_depth: local_component_depth,
        useTaskState,
    };

    return <WithDebugComponent {...componentProps} />;
  }

  TaskComponent.displayName = componentName;
  return TaskComponent;
}

export default withTask