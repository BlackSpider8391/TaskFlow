// Without this we cannot make partial updates to objects in the Task
function deepMerge(prevState, update) {

    if (prevState === undefined) {
      return update;
    }

    if (update === undefined) {
      return prevState;
    }

    const output = { ...prevState };
  
    for (const key of Object.keys(update)) {
      const oldValue = prevState[key];
      const newValue = update[key];
  
      if (newValue === undefined || newValue === null) {
        continue;
      }
  
      if (
        typeof oldValue === "object" &&
        oldValue !== null &&
        !Array.isArray(oldValue) &&
        typeof newValue === "object" &&
        newValue !== null &&
        !Array.isArray(newValue)
      ) {
        output[key] = deepMerge(oldValue, newValue);
      } else {
        output[key] = newValue;
      }
    }
  
    return output;
}

function getChanges(obj1, obj2) {
  const diff = {};

  // Helper function to check if a value is an object
  const isObject = (value) => typeof value === 'object' && value !== null;

  // Iterate over keys in obj1
  Object.keys(obj1).forEach(key => {
    //console.log("getChanges", key, obj1[key], obj2[key])
    if (!obj2.hasOwnProperty(key)) {
      // Missing key from obj2 
    } else if (isObject(obj1[key]) && isObject(obj2[key])) {
      const nestedDiff = getChanges(obj1[key], obj2[key]);
      if (Object.keys(nestedDiff).length > 0) {
        diff[key] = nestedDiff;
      }
    } else if (obj1[key] !== obj2[key]) {
      diff[key] = obj2[key];
    }
  });

  // Iterate over keys in obj2 not in obj1
  Object.keys(obj2).forEach(key => {
    if (!obj1.hasOwnProperty(key) && obj2[key] !== undefined) {
      diff[key] = obj2[key];
    }
  });

  //console.log("getChanges", obj1, obj2, diff)
  return diff;
}

function checkConflicts(obj1, obj2) {
  // Helper function to check if a value is an object
  const isObject = (value) => typeof value === 'object' && value !== null;
  
  // Iterate over keys in obj1
  Object.keys(obj1).forEach(key => {
    if (obj2.hasOwnProperty(key)) {
      if (isObject(obj1[key]) && isObject(obj2[key])) {
        // Recursive check for nested objects
        checkConflicts(obj1[key], obj2[key]);
      } else if (obj1[key] !== obj2[key]) {
        // Conflict detected when values are different
        throw new Error("Conflict in merge: " + key + " " + JSON.stringify(obj1[key]) + " " + JSON.stringify(obj2[key]));
      }
    }
  });
}

export { deepMerge, getChanges, checkConflicts };