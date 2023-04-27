/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
*/

import React, { useState, useEffect } from "react";
import { Stepper, Step, StepLabel, Typography, Button } from "@mui/material";
import { Accordion, AccordionSummary, AccordionDetails } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import DynamicComponent from "./../Generic/DynamicComponent";
import withTask from '../../hoc/withTask';
import { setArrayState } from '../../utils/utils';


// Currently task is only used to create the first task
// Maybe activeTask is just a ref
// How to update a task that is not prop.task (should update form the lower component when possible)
// How to update a child's task fro parent?
// useTasksState to allow for debug

function TaskStepper(props) {

  const {
    log,
    task, 
    setTask, 
    component_depth,
    startTaskLoading,
    startTaskError,
    startTask,
    nextTaskLoading,
    nextTaskError,
    nextTask,
    setDoneTask,
    startTaskFn,
    useTaskState,
  } = props

  const [tasks, setTasks] = useState([]);
  const [tasksIdx, setTasksIdx] = useState(0);
  const [leaving, setLeaving] = useState();
  const [prevTaskName, setPrevTaskName] = useState();
  const [expanded, setExpanded] = useState(['start']);
  const [stepperTask, setStepperTask] = useTaskState(null, 'stepperTask');

  // We are not using stepperTask but potentially it is the task that
  // manages a meta-level related to the stepper (not the actual steps/tasks in the stepper)
  useEffect(() => {
    startTaskFn(task.id, null, component_depth)
  }, []);

  useEffect(() => {
    if (startTask) {
      setStepperTask(startTask)
    }
  }, [startTask]);

  // The first step is the task that was passed in
  useEffect(() => {
      setTasks([task])
      setPrevTaskName(task.name)
  }, []);

  // When task is done then fetch next task
  useEffect(() => {
    if (tasks.length && tasks[tasksIdx].done) {
      setTasksTask(p => { return {...p, done: false} })
      setDoneTask(tasks[tasksIdx])
    }
  }, [tasks]);

  // Detect when new task has been fetched
  useEffect(() => {
    if (nextTask) {
      setTasksIdx(tasks.length)
      setTasks((prevVisitedTasks) => [...prevVisitedTasks, nextTask ])
    }
  }, [nextTask]);

  // Instead of leaving we could have a task.exit ?
  function handleStepperNavigation(currentTask, action) {
    const currentTaskData = tasks[tasksIdx]
    if (action === 'next') {
      if (currentTaskData && currentTaskData.next) {
        // Give control to the active Task which will call taskDone to transition to next state
        setLeaving({direction: 'next', task: currentTask});
        // Expect taskDone to be called from Task, rename leaving to taskLeave
      }
    } else if (action === 'back') {
      if (currentTaskData) { 
        // By updating leaving this ensure there is an event if next is activated
        setLeaving({direction: 'prev', task: currentTask});
        setTasksIdx(tasks.length - 2)
        setTasks((prevVisitedTasks) => prevVisitedTasks.slice(0, -1));
      }
    }
  }
 
  // Close previous task and open next task in stepper
  useEffect(() => {
    if (tasks.length > 0) {
      if (tasks[tasksIdx].name !== prevTaskName) {
        setExpanded((prevExpanded) => [...prevExpanded, tasks[tasksIdx].name]);
        if (prevTaskName) {
          setExpanded((prevExpanded) => prevExpanded.filter((p) => p !== prevTaskName));
        }
        setPrevTaskName(tasks[tasksIdx].name)
      }
    }
  }, [tasksIdx]); 

  // Jump to previously completed steps
  const handleChange = (panel) => (event, newExpanded) => {
    if (newExpanded) {
      setExpanded((prevExpanded) => [...prevExpanded, panel]);
    } else {
      setExpanded((prevExpanded) => prevExpanded.filter((p) => p !== panel));
    }
  };

  const isExpanded = (panel) => expanded.includes(panel);

  function setTasksTask(t) {
    setArrayState(setTasks, tasksIdx, t)
  }

  return (
    <div>
      <Stepper activeStep={tasksIdx}>
        {tasks.map(({ name, label }) => (
          <Step key={`task-${name}`}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      { tasks.map(({ name, label, component, next, instanceId }, idx) => (
          <Accordion key={name} expanded={isExpanded(name)} onChange={handleChange(name)}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography>{label}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              { /* Could pass in a key to DynamicComponent */}
              { component && (
                <DynamicComponent key={instanceId} is={component[component_depth]} task={tasks[idx]} setTask={setTasksTask} leaving={leaving} parentTask={stepperTask}  component_depth={component_depth} />
              )}
            </AccordionDetails>
            <div>
              {tasks[tasksIdx].name !== 'start' && tasks[tasksIdx].name === name && (
                <Button onClick={() => handleStepperNavigation(tasks[tasksIdx], 'back')} variant="contained" color="primary">
                  Back
                </Button>
              )}
              {!/\.stop$/.test(next) && tasks[tasksIdx].name === name && (
                <Button onClick={() => handleStepperNavigation(tasks[tasksIdx], 'next')} variant="contained" color="primary">
                  Next
                </Button>
              )}
            </div>
          </Accordion>
        ))
      }
    </div>
  );
}

export default withTask(TaskStepper);
