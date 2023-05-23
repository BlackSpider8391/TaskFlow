/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
*/

import { processorId } from "../config.mjs";

const syncTasks_async = async (wsSendTask, keyv, key, value) => {

  //console.log("syncTasks_async", key, value);

  const task = value;
  const has = await keyv.has(key);
  if (has) { 
    const activeTask = await keyv.get(key);
    // Here we could calculate the diff
  }

  // Could check if newSource is processorId
  if (!task.newSource.startsWith("hub-")) {
    //console.log("syncTasks_async updating", key);
    wsSendTask(task, "update");
  }

};

export default syncTasks_async;