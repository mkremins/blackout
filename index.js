(function(){
var pos = require('pos');
var lexicon = require('pos/lexicon');

// helper functions

function clone(val){
  return JSON.parse(JSON.stringify(val));
}

function contains(list, item){
  return list.indexOf(item) !== -1;
}

function hasPrefix(str, prefix){
  return str.substring(0, prefix.length) === prefix;
}

function hasSuffix(str, suffix){
  var suffixIdx = str.length - suffix.length;
  return str.indexOf(suffix, suffixIdx) === suffixIdx;
}

function isEmptyOrWhitespace(str){
  return str.replace(/\s+/g, '').length === 0;
}

function normalize(str){
  return str.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
}

function randNth(list){
  return list[Math.floor(Math.random()*list.length)];
}

// constants

var COUNT_ANY = 0;
var COUNT_SINGULAR = 1;
var COUNT_PLURAL = 2;
var COUNT_I = 3; // special pseudo-count for the pronoun 'I' (needs 'am'/'was' for copula)

var INITIAL_ANY = 0;
var INITIAL_CONSONANT = 1;
var INITIAL_VOWEL = 2;

// patterns

var subjectPatterns = [
  // the subject...
  ['Det', 'Noun'],
  // the adjective subject...
  ['Det', 'Adj', 'Noun'],
  // subjects...
  ['Plural'],
  // adjective subjects...
  ['Adj', 'Plural'],
  // subjects and subjects...
  ['Plural', 'And', 'Plural'],
  // the subjects and subjects...
  ['Det', 'Plural', 'And', 'Plural'],
  // Max...
  ['Person'],
  // I...
  ['SubjPrn']
];

var verbObjectPatterns = [
  // ...is adjective
  {verb: ['Copula'], object: ['Adj']},
  // ...is verbing
  {verb: ['Copula'], object: ['Gerund']},
  // ...is the object
  {verb: ['Copula'], object: ['Article', 'Noun']},
  // ...is in the object (DISABLED)
  //{verb: ['Copula'], object: ['Prep', 'Article', 'Noun']},
  // ...is in the adjective object (DISABLED)
  //{verb: ['Copula'], object: ['Prep', 'Article', 'Adjective', 'Noun']},
  // ...is in my object (DISABLED)
  //{verb: ['Copula'], object: ['Prep', 'Possessive', 'Noun']},
  // ...is in my adjective object (DISABLED)
  //{verb: ['Copula'], object: ['Prep', 'Possessive', 'Adj', 'Noun']},
  // ...can verb
  {verb: ['Modal', 'Verb'], object: []},
  // ...can verb the object
  {verb: ['Modal', 'Verb'], object: ['Article', 'Noun']},
  // ...verbs adverbially (DISABLED)
  //{verb: ['Verb', 'Adverb'], object: []},
  // ...verbs the object
  {verb: ['Verb'], object: ['Article', 'Noun']},
  // ...verbs to the object
  //{verb: ['Verb'], object: ['Prep', 'Article', 'Noun']},
  // ...verbs the adjective object
  {verb: ['Verb'], object: ['Article', 'Adj', 'Noun']},
  // ...verbs objects
  {verb: ['Verb'], object: ['Plural']},
  // ...verbs adjective objects
  {verb: ['Verb'], object: ['Adj', 'Plural']},
  // ...verbs objects and objects
  {verb: ['Verb'], object: ['Plural', 'And', 'Plural']},
  // ...verbs the objects and objects
  {verb: ['Verb'], object: ['Det', 'Plural', 'And', 'Plural']},
  // ...verbs to objects and objects
  //{verb: ['Verb'], object: ['Prep', 'Plural', 'And', 'Plural']},
  // ...verbs Max
  {verb: ['Verb'], object: ['Person']},
  // ...verbs me
  {verb: ['Verb'], object: ['ObjPrn']}
  // ...verbs to me
  //{verb: ['Verb'], object: ['Prep', 'ObjPrn']}
];

var patterns = [];
for (var i = 0; i < subjectPatterns.length; i++){
  for (var j = 0; j < verbObjectPatterns.length; j++){
    var pattern = Object.assign({}, verbObjectPatterns[j]);
    pattern.subject = subjectPatterns[i];
    patterns.push(pattern);
  }
}

// known words

var knownWords = {
  // special "glue" words that constitute their own parts of speech for our purposes
  and: {tag: {And: true}},
  not: {tag: {Not: true}},

  // determiners (more added below)
  the: {tag: {Det: true, Article: true}},
  a:   {tag: {Det: true, Article: true}, count: COUNT_SINGULAR, initial: INITIAL_CONSONANT},
  an:  {tag: {Det: true, Article: true}, count: COUNT_SINGULAR, initial: INITIAL_VOWEL},

  // copulas
  is:   {tag: {Copula: true}, count: COUNT_SINGULAR},
  was:  {tag: {Copula: true}, count: COUNT_SINGULAR, compatibleWithI: true},
  are:  {tag: {Copula: true}, count: COUNT_PLURAL},
  were: {tag: {Copula: true}, count: COUNT_PLURAL},
  am:   {tag: {Copula: true}, count: COUNT_I, compatibleWithI: true},

  // pronouns
  i:    {tag: {SubjPrn: true}, count: COUNT_I},
  he:   {tag: {SubjPrn: true}, count: COUNT_SINGULAR},
  she:  {tag: {SubjPrn: true}, count: COUNT_SINGULAR},
  we:   {tag: {SubjPrn: true}, count: COUNT_PLURAL},
  they: {tag: {SubjPrn: true}, count: COUNT_PLURAL},
  me:   {tag: {ObjPrn: true}, count: COUNT_SINGULAR},
  him:  {tag: {ObjPrn: true}, count: COUNT_SINGULAR},
  her:  {tag: {ObjPrn: true}, count: COUNT_SINGULAR},
  us:   {tag: {ObjPrn: true}, count: COUNT_PLURAL},
  them: {tag: {ObjPrn: true}, count: COUNT_PLURAL},
  it:   {tag: {SubjPrn: true, ObjPrn: true}, count: COUNT_SINGULAR},
  you:  {tag: {SubjPrn: true, ObjPrn: true}, count: COUNT_PLURAL},

  // others
  just:  {tag: {Adj: true}},
  kind:  {tag: {Adj: true}},
  like:  {tag: {Verb: true}, count: COUNT_PLURAL},
  made:  {tag: {Verb: true, PastTense: true}},
  own:   {tag: {Verb: true}, count: COUNT_PLURAL},
  thing: {tag: {Noun: true}, count: COUNT_SINGULAR}, // 'thing' is not a gerund for the love of god
  way:   {tag: {Noun: true}, count: COUNT_SINGULAR}
};

// more determiners
['this','that','another','each','every','no'].forEach(function(word){
  knownWords[word] = {tag: {Det: true}, count: COUNT_SINGULAR};
});
['these','those','all','both','few','many','most','other','several','some','such'].forEach(function(word){
  knownWords[word] = {tag: {Det: true}, count: COUNT_PLURAL};
});

var blacklisted = {
  also: true,
  always: true,
  anyone: true,
  be: true, // we basically never want this as our sentence's main verb
  been: true, // ditto
  else: true,
  here: true,
  maybe: true,
  more: true,
  much: true,
  never: true, // TODO use this for something (similar to 'not')
  over: true,
  really: true,
  same: true,
  so: true,
  then: true,
  there: true,
  very: true,
  which: true
};

// word classification

function shouldIgnore(word){
  return blacklisted[word.normal] ||
         isEmptyOrWhitespace(word.normal) ||
         word.text.indexOf('\'') !== -1 ||
         word.text.indexOf('’') !== -1 ||
         word.text.indexOf('—') !== -1;
}

var genericTagMappings = {
  JJ:  {tag: {Adj: true}},
  JJR: {tag: {Adj: true, Comparative: true}},
  JJS: {tag: {Adj: true, Superlative: true}},
  MD:  {tag: {Modal: true}},
  NN:  {tag: {Noun: true}, count: COUNT_SINGULAR},
  NNS: {tag: {Noun: true, Plural: true}, count: COUNT_PLURAL},
  VB:  {tag: {Verb: true}, count: COUNT_PLURAL},
  VBD: {tag: {Verb: true, PastTense: true}},
  VBG: {tag: {Gerund: true}},
  VBN: {tag: {PastParticiple: true}},
  VBP: {tag: {Verb: true}, count: COUNT_PLURAL},
  VBZ: {tag: {Verb: true}, count: COUNT_SINGULAR}
};

['SYM',',','.',':','$','#','"','(',')'].forEach(function(initTag){
  genericTagMappings[initTag] = {isPunctuation: true};
});

function classify(word){
  word.tag = {};
  if (shouldIgnore(word)){
    // never use explicitly blacklisted words
  }
  else if (knownWords[word.normal]){
    word = Object.assign(word, clone(knownWords[word.normal]));
  }
  else if (contains(['CC','DT','PDT','PP$','PRP'], word.initTag)){
    // If the word's initTag is "fully enumerated", all legal words for that tag should be known.
    // Thus, if we get here, it might be worth logging the word to see if we've missed any legal words.
    word.tag = {};
  }
  else {
    if (word.lexTags && !contains(word.lexTags, word.initTag)){
      word.initTag = word.lexTags[0];
    }
    var info = genericTagMappings[word.initTag];
    if (info){
      word = Object.assign(word, clone(info));
    }
  }
  return word;
}

function taggedTokenToWord(taggedToken){
  var text = taggedToken[0];
  var normal = normalize(text);
  return {
    text: text,
    initTag: taggedToken[1],
    normal: normal,
    lexTags: lexicon[normal]
  };
}

function wordify(text){
  var tokens = text.split(/\s+/g).filter(s => s && !isEmptyOrWhitespace(s));
  var tagger = new pos.Tagger();
  var taggedTokens = tagger.tag(tokens);
  var words = taggedTokens.map(taggedTokenToWord);
  words = words.map(classify);
  return words;
}

// pattern matching

function hasRequiredCount(word, requiredCount){
  if (requiredCount === COUNT_ANY || !word.count){
    return true;
  } else if (requiredCount === COUNT_I) {
    // 'I' takes 'am'/'was' for copula, plural forms otherwise
    return word.tag.Copula ? word.compatibleWithI : requiredCount === COUNT_PLURAL;
  } else {
    return requiredCount === word.count;
  }
}

function hasRequiredInitial(word, requiredInitial){
  if (requiredInitial === INITIAL_ANY || !requiredInitial){
    return true;
  } else {
    var initial = word.normal.substring(0,1);
    var actual = contains(['a','e','i','o','u'], initial) ? INITIAL_VOWEL : INITIAL_CONSONANT;
    return requiredInitial === actual;
  }
}

function logWord(word){
  var columns = [word.text,
                 word.initTag,
                 Object.keys(word.tag).join(','),
                 (word.lexTags || []).join(','),
                 word.count];
  console.log(columns.join(' | '));
}

function shouldAccept(word, tag, count, initial){
  return word.tag[tag] &&
         hasRequiredCount(word, count) &&
         hasRequiredInitial(word, initial) &&
         Math.random() < 0.9;
}

function matchWordSequence(words, pattern){
  words = clone(words);
  var wordIdx = 0;
  var word;
  var patternIdx;
  var requiredCount = COUNT_ANY;
  var requiredInitial = INITIAL_ANY;

  // subject
  patternIdx = 0;
  while (patternIdx < pattern.subject.length){
    word = words[wordIdx];
    if (!word) return null; // no more words to try!
    if (shouldAccept(word, pattern.subject[patternIdx], requiredCount, requiredInitial)){
      word.marked = true;
      patternIdx += 1;
      if (word.count){
        requiredCount = word.count;
      }
      if (word.initial){
        requiredInitial = word.initial;
      } else {
        requiredInitial = INITIAL_ANY;
      }
    }
    wordIdx += 1;
  }

  // verb
  var isModal = pattern.verb[0] === 'Modal';
  if (isModal){
    requiredCount = COUNT_PLURAL;
  }
  patternIdx = 0;
  while (patternIdx < pattern.verb.length){
    word = words[wordIdx];
    if (!word) return null; // no more words to try!
    if (shouldAccept(word, pattern.verb[patternIdx], requiredCount) &&
        !(isModal && word.tag.PastTense)){
      word.marked = true;
      patternIdx += 1;
    }
    wordIdx += 1;
  }

  // object
  requiredCount = COUNT_ANY;
  patternIdx = 0;
  while (patternIdx < pattern.object.length){
    word = words[wordIdx];
    if (!word) return null; // no more words to try!
    if (shouldAccept(word, pattern.object[patternIdx], requiredCount, requiredInitial)){
      word.marked = true;
      patternIdx += 1;
      if (word.count){
        requiredCount = word.count;
      }
      if (word.initial){
        requiredInitial = word.initial;
      } else {
        requiredInitial = INITIAL_ANY;
      }
    }
    wordIdx += 1;
  }

  return words; // if we've gotten this far, all the words were found
}

function writePoemifiedText(node, words){
  var innerHTML = '';
  var prevWasBlackedOut = false;
  var blackoutColor = getComputedStyle(node).getPropertyValue('color');
  var blackoutPrefix = ' <span style="background:' + blackoutColor + '">';
  for (var j = 0; j < words.length; j++){
    var word = words[j];
    if (word.marked){
      if (prevWasBlackedOut){
        innerHTML = innerHTML + '</span> ' + word.text;
      } else {
        innerHTML = innerHTML + ' ' + word.text;
      }
      prevWasBlackedOut = false;
    } else {
      if (prevWasBlackedOut){
        innerHTML = innerHTML + ' ' + word.text;
      } else {
        innerHTML = innerHTML + blackoutPrefix + word.text;
      }
      prevWasBlackedOut = true;
    }
  }
  node.innerHTML = innerHTML;
}

function poemify(selector){
  var nodes = document.querySelectorAll(selector);
  for (var i = 0; i < nodes.length; i++){
    // get a series of words from the node's text
    var node = nodes[i];
    if (isEmptyOrWhitespace(node.innerText)) continue; // bail out early if there isn't any text
    console.log(node.innerText);
    var words = wordify(node.innerText);

    // mark words to keep (i.e. not black out)
    var matchedWords = null;
    var attempts = 0;
    while (!matchedWords && attempts < 20){
      var pattern = randNth(patterns);
      matchedWords = matchWordSequence(words, pattern);
      if (matchedWords){
        console.log(pattern.subject.concat(pattern.verb).concat(pattern.object).join(','));
        var marked = (matchedWords || []).filter(w => w.marked);
        console.log(marked.map(w => w.text).join(' '));
        marked.map(logWord);
      }
      attempts += 1;
    }
    if (matchedWords){
      words = matchedWords;
    }

    // write text back into the node with most words blacked out
    writePoemifiedText(node, words);
  }
}

poemify('p, li, dd');
})();
