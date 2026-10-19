import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechTurnDetector } from '../src/voice/turnDetector.js';
import { openConversation } from '../src/voice/conversation.js';

const frame = (value=.05) => new Float32Array(512).fill(value);
const feed = (detector, probability, count, mode) => { for(let i=0;i<count;i++) detector.push(frame(), [probability], mode); };

test('Silero speech opens a turn, preserves pre-roll, and ends after a pause', () => {
  const starts=[], ends=[];
  const detector=new SpeechTurnDetector({onStart:event=>starts.push(event),onEnd:event=>ends.push(event)});
  feed(detector,.01,20);
  feed(detector,.92,10);
  feed(detector,.01,24);
  assert.equal(starts.length,1); assert.equal(ends.length,0);
  feed(detector,.01,1);
  assert.equal(ends.length,1); assert.equal(ends[0].reason,'silence');
  assert.ok(ends[0].chunks.length>35,'Leading audio must be retained before confirmation');
  assert.equal(detector.active,false);
});

test('a loud frame marked non-speech by Silero does not trigger a turn', () => {
  let starts=0;
  const detector=new SpeechTurnDetector({onStart:()=>starts++,onEnd(){}});
  for(let i=0;i<40;i++) detector.push(frame(.95),[.04]);
  assert.equal(starts,0);
});

test('a short probability spike does not interrupt a spoken reply', () => {
  const starts=[];
  const detector=new SpeechTurnDetector({onStart:event=>starts.push(event),onEnd(){}});
  feed(detector,.99,6,{assistantSpeaking:true});
  feed(detector,.01,1,{assistantSpeaking:true});
  assert.equal(starts.length,0);
});

test('sustained speech during a reply emits an interruption and captures a new turn', () => {
  const starts=[],ends=[];
  let playing=true, paused=false;
  const detector=new SpeechTurnDetector({onStart:event=>{starts.push(event);if(event.interruption){playing=false;paused=true;}},onEnd:event=>ends.push(event)});
  feed(detector,.72,15,{assistantSpeaking:true});
  assert.equal(playing,true);
  feed(detector,.96,7,{assistantSpeaking:true});
  assert.equal(playing,false); assert.equal(paused,true); assert.equal(starts[0].interruption,true);
  feed(detector,.9,10);feed(detector,.01,25);
  assert.equal(ends.length,1);
  feed(detector,.93,8);feed(detector,.01,25);
  assert.equal(starts.length,2); assert.equal(ends.length,2);
});

test('a long utterance is bounded and discarded buffers are not reused', () => {
  const ends=[];
  const detector=new SpeechTurnDetector({onStart(){},onEnd:event=>ends.push(event)});
  feed(detector,.99,880);
  assert.equal(ends.length,1);assert.ok(ends[0].seconds<=28.01);
  detector.reset();assert.equal(detector.finish(),false);
});

test('invalid probabilities and mismatched audio fail explicitly', () => {
  const detector=new SpeechTurnDetector({onStart(){},onEnd(){}});
  assert.throws(()=>detector.push(frame(),[]),/do not match/);
  assert.throws(()=>detector.push(frame(),[NaN]),/Invalid/);
});

test('a cancelled conversation never opens a microphone or socket', async () => {
  const controller=new AbortController();controller.abort();
  await assert.rejects(openConversation({signal:controller.signal}),{name:'AbortError'});
});

test('ending a live session closes its stream, worklet, and websocket', async () => {
  const keys=['window','navigator','AudioContext','AudioWorkletNode','WebSocket'];
  const descriptors=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let stopped=0,closed=0,socketClosed=0,socket;
  const track={stop(){stopped++;},onended:null};
  const connectable=()=>({connect(){},disconnect(){}});
  class Context {
    sampleRate=16000;state='running';destination={};audioWorklet={async addModule(){}};
    async resume(){}createMediaStreamSource(){return connectable();}createGain(){return {...connectable(),gain:{value:1}};}
    async close(){closed++;this.state='closed';}
  }
  class Worklet {port={onmessage:null};connect(){}disconnect(){}}
  class Socket {
    static OPEN=1;static CLOSING=2;
    readyState=1;bufferedAmount=0;
    constructor(){socket=this;queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'ready'})}));}
    close(){socketClosed++;this.readyState=3;}
  }
  const environment={window:{AudioContext:Context,AudioWorkletNode:Worklet,WebSocket:Socket,location:{protocol:'http:',host:'localhost:5173'}},navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[track],getAudioTracks:()=>[track]};}}},AudioContext:Context,AudioWorkletNode:Worklet,WebSocket:Socket};
  for(const [key,value] of Object.entries(environment))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  try {
    const controller=new AbortController();
    const session=await openConversation({signal:controller.signal,onLevel(){},onProbability(){},onSpeechStart(){},onUtterance(){},onDuration(){},onError(error){throw error;},isAssistantSpeaking:()=>false});
    session.cancel();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(stopped,1);assert.equal(closed,1);assert.equal(socketClosed,1);assert.equal(socket.readyState,3);
  } finally {
    for(const [key,descriptor] of Object.entries(descriptors)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});
