/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
*/

import { useState, useEffect, useRef } from "react";
import { useGlobalStateContext } from "../contexts/GlobalStateContext";
import { fetchTask } from "../utils/fetchTask";
import { log } from "../utils/utils";

const useStartTask = (startId, threadId = null, component_depth = 0) => {
  const { globalState } = useGlobalStateContext();
  const [startTaskError, setTaskStartError] = useState();

  useEffect(() => {
    if (!startId) {
      return;
    }
    const fetchTaskFromAPI = async () => {
      try {
        log("useStartTask", startId);
        console.log("Starting task ", startId)
        let task = { id: startId, stackPtr: component_depth };
        if (threadId) {
          task["threadId"] = threadId;
        }
        fetchTask(globalState, "task/start", task);
      } catch (error) {
        setTaskStartError(error.message);
      }
    };

    fetchTaskFromAPI();
  // eslint-disable-next-line
  }, [startId]);

  return { startTaskError };
};

export default useStartTask;
