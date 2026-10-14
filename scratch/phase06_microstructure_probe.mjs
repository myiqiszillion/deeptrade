import '../scripts/offline_guard.cjs';
import {MicrostructureEngine} from './phase06_microstructure_before_source.ts';
const m=new MicrostructureEngine();m.recordTick({id:'ES-fixture',timestamp:Date.now(),price:100,size:2,side:'buy'},'ES');m.recordTick({id:'NQ-fixture',timestamp:Date.now(),price:100,size:3,side:'sell'},'NQ');console.log(JSON.stringify({scope:'OFFLINE REPRODUCTION',expected:{ES:{buy:1,sell:0,volumeImbalance:1},NQ:{buy:0,sell:1,volumeImbalance:-1}},actual:{ES:m.snapshot('ES',null),NQ:m.snapshot('NQ',null)}}));
