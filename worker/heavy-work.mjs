// One synchronous, non-queuing gate per isolate, shared by every Worker/adapter instance.
// Acquire before reading large input or calling upstream; never retain queued bodies.
let heavyWorkHeld=false;
export function acquireHeavyWork(status=429){
 if(heavyWorkHeld)throw Object.assign(new Error('Image processing is busy; retry the same operation shortly'),{status});
 heavyWorkHeld=true;let released=false;
 return ()=>{if(!released){released=true;heavyWorkHeld=false;}};
}
