import assert from 'node:assert/strict';import test from 'node:test';
import {compareSourceGrid} from './measure-source-resolution';
test('source reduction preserves an exactly representable plane and exposes lost curvature',()=>{
 const width=100,plane=new Float32Array(width*width),curve=new Float32Array(width*width);
 for(let r=0;r<width;r++)for(let c=0;c<width;c++){plane[r*width+c]=2000+c+r;curve[r*width+c]=2000+5*Math.sin(c/4)*Math.cos(r/7);}
 assert.ok(compareSourceGrid(plane,width,width,1,4).maxAbsoluteM<1e-8);
 assert.ok(compareSourceGrid(curve,width,width,1,8).rmseM>compareSourceGrid(curve,width,width,1,2).rmseM*5);
});
test('invalid source data and windows fail instead of becoming elevation evidence',()=>{
 const data=new Float32Array(100).fill(2000);data[2]=-999999;
 assert.throws(()=>compareSourceGrid(data,10,10,1,2),/invalid source/);
 assert.throws(()=>compareSourceGrid(new Float32Array(100),10,10,1,100),/too small/);
 assert.throws(()=>compareSourceGrid(new Float32Array(100),10,10,1,.5),/spacing/);
});
