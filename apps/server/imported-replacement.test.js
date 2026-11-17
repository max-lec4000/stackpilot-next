import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replacementAllowed} from './imported-replacement.js';
const profile={minFormatScore:1,items:[{allowed:true,quality:{id:7}}]};
const target={item:{id:11}};
const release={protocol:'torrent',downloadAllowed:true,approved:false,rejections:['Existing file meets cutoff: WEBDL-1080p'],infoHash:'a'.repeat(40),customFormatScore:1,size:2*1024**3,quality:{quality:{id:7}},movieId:11,guid:'test-release',indexerId:1};
test('explicit replacement can override existing-file cutoff but not size, quality or format constraints',()=>{
  assert.ok(replacementAllowed(release,target,profile,3));
  for(const changes of [{size:4*1024**3},{customFormatScore:0},{rejections:['No audio tracks detected']},{quality:{quality:{id:8}}},{movieId:12},{downloadAllowed:false},{infoHash:''}])assert.ok(!replacementAllowed({...release,...changes},target,profile,3));
});
test('one episode replacement never admits a season pack or a second episode',()=>{
  const episode={id:17},one={...release,fullSeason:false,mappedEpisodeInfo:[{id:17}]};
  assert.ok(replacementAllowed(one,target,profile,3,episode));
  assert.ok(!replacementAllowed({...one,fullSeason:true},target,profile,3,episode));
  assert.ok(!replacementAllowed({...one,mappedEpisodeInfo:[{id:17},{id:18}]},target,profile,3,episode));
});
