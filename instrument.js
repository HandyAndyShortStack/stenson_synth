_.mixin({
  keyMap: function(map,func,context) {
    var acc = {};
    _.each(map,function(v,k){
      var result = func.apply(context,[v,k]);
      acc[result.key] = result.value;
    });
    return acc;
  },
  repeat: function(func,times) {
    return _.map(_.range(0,times),func);
  },
  $flatten: function(nodes) {
    return _.foldr(nodes,function(acc,node){
      return (acc) ? node.before(acc) : node;
    },null);
  }
});

// fiddle is a closure (self-contained engine)
// everything else is MVC

var fiddle = (function(){
  
  var context = new webkitAudioContext,
    convolver = context.createConvolver(),
    getSound = function(url,callback) {
      var request = new XMLHttpRequest();
      request.open("GET", url, true);
      request.responseType = "arraybuffer";
      request.onload = function() {
        callback(request.response);
      };
      request.send();
    },
    standardSettings = {
      
    },
    sounds = {},
    getSoundNamed = function(file,name) {
      getSound(file,function(response){
        sounds[name] = context.createBuffer(response,false);
      });
    },
    getSoundsNamed = function(hash) {
      _.each(hash,getSoundNamed);
    },
    dryConnect = function(node,mainGain) {
      var dryGainNode = context.createGainNode();
      dryGainNode.gain.value = mainGain;
      node.connect(dryGainNode);
      dryGainNode.connect(context.destination);
    },
    wetConnect = function(node,sendGain) {
      var wetGainNode = context.createGainNode();
      wetGainNode.gain.value = sendGain;
      node.connect(wetGainNode);
      wetGainNode.connect(convolver);
    },
    playSound = function(hash) {
      var voice = context.createBufferSource();
      voice.buffer = hash.buffer;
      dryConnect(voice,hash.mainGain);
      wetConnect(voice,hash.sendGain);
      voice.noteOn(hash.time);
    },
    turnovers = [];
  
  (function turnover(){
    var current = context.currentTime;
    _.each(turnovers,function(pair,i){
      if(pair) {
        var time = pair[0];
        // could get some funky time-laggy stuff here
        // if you tweak the subtraction
        if(current > time - 0.05) {
          pair[1](time,pair[2]);
          turnovers[i] = false; // clear it
        }
      }
    });
    setTimeout(turnover,0);
  })();
  
  (function garbageCollect(){
    turnovers = _.without(turnovers,false);
    setTimeout(garbageCollect,300);
  })();
  
  // not sure what this does...
  convolver.connect(context.destination);
  
  return {
    getSound: getSound,
    context: context,
    sounds: sounds,
    turnovers: function() {
      return turnovers;
    },
    play: function(hash) {
      playSound({
        buffer: sounds[hash.name],
        sendGain: 0.3,
        mainGain: 0.8,
        cutoff: 22050,
        resonance: 5,
        time: hash.time || 0.0
      });
    },
    time: function() {
      return context.currentTime;
    },
    loadSound: getSoundNamed,
    loadSounds: getSoundsNamed(sounds),
    schedule: function(time,fn,extras) {
      turnovers.push([time,fn,extras]);
    }
  };
  
})();

/* the sequencer */

var sequencerLength = 32,
  length = sequencerLength * 0.125;

var Note = Backbone.Model.extend({
  initialize: function() {
    this.loadSound();
    for(var i = this.get("sequence").length; i < sequencerLength; i += 1) {
      this.get("sequence")[i] = 0;
    }
  },
  loadSound: function() {
    fiddle.loadSound(this.get("file"),this.get("name"));
  },
  play: function(time) {
    fiddle.play({
      name: this.get("name"),
      time: time
    });
  }
});

var NoteRow = Backbone.View.extend({
  className: "row",
  initialize: function() {
    _.bindAll(this,"update");
    this.render(this);
    this.model.bind("change:sequence",this.update);
  },
  render: function(that) {
    this.buttons = _.map(this.model.get("sequence"),function(block,i){
      var div = $("<div/>",{
        className: "block",
        click: function() {
          $(this).toggleClass("on");
          that.model.get("sequence")[i] = $(this).hasClass("on");
        }
      }).appendTo($(this.el));
      if(block) div.addClass("on");
      if((i+1)%4 === 0 && i+1 > 0) {
        $("<div/>",{
          className: "divider"
        }).appendTo($(this.el));
      }
      return div;
    },this);
  },
  update: function() {
    _.each(this.model.get("sequence"),function(should,i){
      (should) ? this.buttons[i].addClass("on") : this.buttons[i].removeClass("on");
    },this);
  }
});

var Instrument = Backbone.Collection.extend({
  model: Note,
  initialize: function() {
    this.asHash();
  },
  asHash: function() {
    this.byName = _.keyMap(this.models,function(note){
      return {
        key: note.get("name"),
        value: note
      }
    });
  },
  play: function() {
    this.each(function(note){
      note.play();
    });
  },
  noteNamed: function(name) {
    return this.byName[name];
  },
  sequences: function() {
    return _.map(this.models,function(model){
      return {
        sequence: model.get("sequence"),
        note: model
      };
    });
  }
});

var Sequencer = Backbone.Model.extend({
  initialize: function() {
    _.bindAll(this,"run");
    this.set({ instrument: new Instrument(this.get("instrument")) });
    this.measures = 0;
  },
  start: function() {
    var time = fiddle.time(),
      blockTime = length/8;
      
    // schedule eight run blocks corresponding to the whole thing
    _.each([0,1,2,3,4,5,6,7],function(n){
      fiddle.schedule(time+blockTime*n,this.run,[4*n,4*(n+1)]);
    },this);
    
    this.lights = $("div.light");
  },
  run: function(time,bounds) {
    this.measures += 1;
    //if(this.measures%32 === 0) this.randomize();
    this.schedule(this.get("instrument").sequences(),time,bounds);
  },
  schedule: function(sequences,time,bounds) {
    $(this.lights.get(bounds[0]/4)).animate({ opacity: 1.0 },"fast",function(){
      $(this).animate({ opacity: 0.2 },"fast");
    });
    _.each(sequences,function(sequence){
      _.each(sequence.sequence.slice(bounds[0],bounds[1]),function(should,i){
        if(should) {
          sequence.note.play(time+(i/8));
        }
      });
    });
    fiddle.schedule(time+length,this.run,bounds);
  },
  randomize: function() {
    this.get("instrument").each(function(sound){
      sound.set({
        sequence: randomSequence( (sound.get("file").indexOf("cello")) === 0 ? 0.05 : 0.1 )
      });
    });
  },
  clear: function() {
    var falses = _.repeat(function(){ return false; },32);
    this.get("instrument").each(function(sound){
      sound.set({ sequence: falses });
    })
  }
});

var LEDIndicator = Backbone.View.extend({
  className: "row",
  initialize: function() {
    _.bindAll(this,"light");
    $(this.el).append(_.$flatten(_.repeat(this.light,8)))
  },
  light: function() {
    return $("<div/>",{
      className: "light"
    });
  }
});

var SequencerPanel = Backbone.View.extend({
  className: "sequencer-panel",
  initialize: function() {
    this.model.get("instrument").each(function(note){
      var row = new NoteRow({ model: note });
      $(this.el).append($(row.el));
    },this);
    
    $("#start").click(function(){
      sequencer.start();
    });
    
    var lights = new LEDIndicator();
    $(this.el).prepend($(lights.el));
  }
});

var randomSequence = function(tolerance) {
  return _.map(_.range(0,32),function(n){
    return Math.random() < tolerance;
  });
};

sounds = _.map(["kick","snare","hihat","tom2","tom3"],function(name){
  return {
    name: name,
    file: name+".wav",
    sequence: randomSequence(0)
  }
});

_.each(["a","b","c","d","e","f","g"],function(letter){
  _.each([3,4],function(n){
    sounds.push({
      name: letter+n,
      file: "cello/"+letter.toUpperCase()+n+".wav",
      sequence: randomSequence(0)
    });
  });
});

var sequencer = new Sequencer({
  instrument: sounds
});

$(function(){
  var sview = new SequencerPanel({
    model: sequencer
  });
  $("body").prepend($(sview.el));
  $("#randomize").click(_.bind(sequencer.randomize,sequencer));
  $("#clear").click(_.bind(sequencer.clear,sequencer));
});