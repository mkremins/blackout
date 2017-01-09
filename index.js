(function(){
var nlp = window.nlp_compromise;

// helper functions

function contains(list, item){
  return list.indexOf(item) !== -1;
}

function flatten1(list){
  return Array.prototype.concat.apply([], list);
}

function randNth(list){
  return list[Math.floor(Math.random()*list.length)];
}

function deepCopy(list){
  return list.map(obj => Object.assign({}, obj));
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
  ['Determiner', 'NormalNoun'],
  // the adjective subject...
  ['Determiner', 'Adjective', 'NormalNoun'],
  // subjects...
  ['PluralNoun'],
  // adjective subjects...
  ['Adjective', 'PluralNoun'],
  // subjects and subjects...
  ['PluralNoun', 'And', 'PluralNoun'],
  // the subjects and subjects...
  ['Determiner', 'PluralNoun', 'And', 'PluralNoun'],
  // Max...
  ['Person'],
  // I...
  ['SubjectPronoun']
];

var verbObjectPatterns = [
  // ...is adjective
  {verb: ['Copula'], object: ['Adjective']},
  // ...is verbing
  {verb: ['Copula'], object: ['Gerund']},
  // ...is the object
  {verb: ['Copula'], object: ['Article', 'NormalNoun']},
  // ...is in the object (DISABLED)
  //{verb: ['Copula'], object: ['Preposition', 'Article', 'NormalNoun']},
  // ...is in the adjective object (DISABLED)
  //{verb: ['Copula'], object: ['Preposition', 'Article', 'Adjective', 'NormalNoun']},
  // ...is in my object (DISABLED)
  //{verb: ['Copula'], object: ['Preposition', 'Possessive', 'NormalNoun']},
  // ...is in my adjective object (DISABLED)
  //{verb: ['Copula'], object: ['Copula', 'Preposition', 'Possessive', 'Adjective', 'NormalNoun']},
  // ...can verb
  {verb: ['ModalVerb', 'NormalVerb'], object: []},
  // ...can verb the object
  {verb: ['ModalVerb', 'NormalVerb'], object: ['Article', 'NormalNoun']},
  // ...verbs adverbially (DISABLED)
  //{verb: ['NormalVerb', 'Adverb'], object: []},
  // ...verbs the object
  {verb: ['NormalVerb'], object: ['Article', 'NormalNoun']},
  // ...verbs to the object
  //{verb: ['NormalVerb'], object: ['Preposition', 'Article', 'NormalNoun']},
  // ...verbs the adjective object
  {verb: ['NormalVerb'], object: ['Article', 'Adjective', 'NormalNoun']},
  // ...verbs objects
  {verb: ['NormalVerb'], object: ['PluralNoun']},
  // ...verbs adjective objects
  {verb: ['NormalVerb'], object: ['Adjective', 'PluralNoun']},
  // ...verbs objects and objects
  {verb: ['NormalVerb'], object: ['PluralNoun', 'And', 'PluralNoun']},
  // ...verbs the objects and objects
  {verb: ['NormalVerb'], object: ['Determiner', 'PluralNoun', 'And', 'PluralNoun']},
  // ...verbs to objects and objects
  //{verb: ['NormalVerb'], object: ['Preposition', 'PluralNoun', 'And', 'PluralNoun']},
  // ...verbs Max
  {verb: ['NormalVerb'], object: ['Person']},
  // ...verbs me
  {verb: ['NormalVerb'], object: ['ObjectPronoun']}
  // ...verbs to me
  //{verb: ['NormalVerb'], object: ['Preposition', 'ObjectPronoun']}
];

var patterns = [];
for (var i = 0; i < subjectPatterns.length; i++){
  for (var j = 0; j < verbObjectPatterns.length; j++){
    var pattern = Object.assign({}, verbObjectPatterns[j]);
    pattern.subject = subjectPatterns[i];
    patterns.push(pattern);
  }
}

// term classification

function classifyCopula(term){
  term.cat = {Copula: true};
  var text = normalize(term.text);
  if (hasPrefix(text, 'are') || hasPrefix(text, 'were')){
    term.requiredCount = COUNT_PLURAL;
  } else if (hasPrefix(text, 'is')){
    term.requiredCount = COUNT_SINGULAR;
  } else if (hasPrefix(text, 'was')){
    term.requiredCount = COUNT_SINGULAR;
    term.compatibleWithI = true;
  } else if (hasPrefix(text, 'am')){
    term.requiredCount = COUNT_I;
    term.compatibleWithI = true;
  }
}

function classifyDeterminer(term){
  term.cat = {Determiner: true};
  var text = normalize(term.text);
  if (text === 'the'){ // definite article
    term.cat.Article = true;
  }
  else if (text === 'a' || text === 'an'){ // indefinite article
    term.cat.Article = true;
    term.requiredCount = COUNT_SINGULAR;
    term.requiredInitial = (text === 'a') ? INITIAL_CONSONANT : INITIAL_VOWEL;
  }
  else if (text === 'this' || text === 'that'){ // singular demonstrative
    term.requiredCount = COUNT_SINGULAR;
  }
  else if (text === 'these' || text === 'those'){ // plural demonstrative
    term.requiredCount = COUNT_PLURAL;
  }
  else if (contains(['another','each','every','no'], text)){ // singular quantifier
    term.requiredCount = COUNT_SINGULAR;
  }
  else if (contains(['all','both','some','many','other'], text)){ // plural quantifier
    term.requiredCount = COUNT_PLURAL;
  }
  else if (text === 'own'){ // reclassify as verb
    term.cat = {NormalVerb: true};
    term.requiredCount = COUNT_PLURAL;
  }
  else if (text === 'much'){
    term.cat = {}; // TODO: not sure what to do with these
  }
}

function classifyPossessive(term){
  var text = normalize(term.text);
  if (contains(['anything','something'], text)){ // TODO: 'everything'? 'nothing'?
    term.cat = {MassNoun: true}; // noun that doesn't take a determiner
  } else if (contains(['myself','yourself'], text)){
    term.cat = {}; // TODO: not sure what to do with these
  } else {
    term.cat = {Determiner: true, Possessive: true};
  }
}

function classifyPronoun(term){
  var text = normalize(term.text);
  if (text === 'i'){ // 'I' is special
    term.cat = {SubjectPronoun: true};
    term.requiredCount = COUNT_I;
  }
  else if (contains(['he','she'], text)){ // singular subject
    term.cat = {SubjectPronoun: true};
    term.requiredCount = COUNT_SINGULAR;
  }
  else if (contains(['we','they'], text)){ // plural subject
    term.cat = {SubjectPronoun: true};
    term.requiredCount = COUNT_PLURAL;
  }
  else if (contains(['me','him','her'], text)){ // singular object
    term.cat = {ObjectPronoun: true};
    term.requiredCount = COUNT_SINGULAR;
  }
  else if (contains(['us','them'], text)){ // plural object
    term.cat = {ObjectPronoun: true};
    term.requiredCount = COUNT_PLURAL;
  }
  else if (contains(['it'], text)){ // singular flexible
    term.cat = {SubjectPronoun: true, ObjectPronoun: true};
    term.requiredCount = COUNT_SINGULAR;
  }
  else if (contains(['you'], text)){ // plural flexible
    term.cat = {SubjectPronoun: true, ObjectPronoun: true};
    term.requiredCount = COUNT_PLURAL;
  }
  else if (contains(['who'], text)){
    term.cat = {}; // 'who' isn't useful to us as a pronoun
  }
  else {
    term.cat = {SubjectPronoun: true, ObjectPronoun: true};
  }
}

function classifyVerb(term){
  term.cat = {NormalVerb: true};
  if (term.pos.PresentTense){
    term.requiredCount = COUNT_SINGULAR;
  }
  else if (term.pos.Infinitive || term.pos.PastTense || term.pos.PerfectTense){
    term.requiredCount = COUNT_PLURAL;
  }
  else if (term.pos.PluperfectTense || term.pos.FutureTense) {
    // e.g. 'had failed', 'will prevent'
    // compatible with both singular and plural - don't set a required count
  }
  else { // no obvious tense, so let's use heuristics!
    var text = normalize(term.text);
    if (text === 'has') {
      term.requiredCount = COUNT_SINGULAR;
    }
    else if (hasSuffix(text, 'ss')){
      // e.g. 'pass', 'dress', 'stress'
      term.requiredCount = COUNT_PLURAL;
      term.cat.DUBIOUS_VERB = true;
    }
    else if (hasSuffix(text, 's')) {
      // e.g. 'fails', 'passes'
      term.requiredCount = COUNT_SINGULAR;
      term.cat.DUBIOUS_VERB = true;
    }
    else if (hasSuffix(text, 'eed')){
      // e.g. 'need', 'bleed', 'speed', 'seed', 'weed', 'breed', 'heed', 'proceed'...
      term.requiredCount = COUNT_PLURAL;
      term.cat.DUBIOUS_VERB = true;
    }
    else if (contains(['bed','embed','sled'], text)){
      // can't just check for ('-ed' && shorter than 5 chars) bc of exceptions
      // (e.g. 'bred', 'fled', 'led', 'shed', 'sped')
      term.requiredCount = COUNT_PLURAL;
    }
    else if (hasSuffix(text, 'ed')) {
      // it's probably past tense - don't set a required count
      term.cat.DUBIOUS_VERB = true;
      term.pos.PastTense = true; // need this to avoid using it with modals
    }
    // TODO do we care about past tense with '-d', e.g. 'trod'/'slid'?
    // (or exceptions e.g. 'nod'?)
    // (or past tense with '-t', e.g. 'built'?)
    else {
      // it seems like misclassified verbs are usually in infinitive form?
      term.requiredCount = COUNT_PLURAL;
      term.cat.DUBIOUS_VERB = true;
    }
  }
}

function isAdverb(term){
  if (term.pos.Adverb) return true;
  if (!term.pos.Noun) return false;
  var text = normalize(term.text);
  if (['likely','only'].indexOf(text) !== -1) return false;
  if (hasSuffix(text, 'fly')) return false; // fly, butterfly, etc
  if (hasSuffix(text, 'belly')) return false; // belly, underbelly, etc
  if (['ally','anomaly','assembly','bully','dolly','doily','family','gully',
       'hillbilly','holly','homily','jelly','lily','monopoly','panoply','rally',
       'reply','supply','tally'].indexOf(text) !== -1){
    return false; // list from http://srufaculty.sru.edu/david.dailey/words/lys.html
  }
  return hasSuffix(text, 'ly');
}

function isGerund(term){
  if (term.pos.Gerund) return true;
  if (!term.pos.Verb) return false;
  var text = normalize(term.text);
  if (text.length < 5) return false;
  if (text.length === 5){
    return ['being','crying','doing','dying','going','lying'].indexOf(text) !== -1;
  }
  return hasSuffix(text, 'ing');
}

var blacklist = [
  'also',
  'always',
  'anyone',
  'be', // we basically never want this as our sentence's main verb
  'been', // ditto
  'else',
  'here',
  'maybe',
  'over',
  'really',
  'same',
  'so',
  'then',
  'there',
  'which'
];

var determiners = [
  'a', 'an', 'the',
  'this', 'that', 'these', 'those',
  'another', 'each', 'every', 'no',
  'all', 'both', 'many', 'other', 'some'
];

var pronouns = [
  'i', 'he', 'she', 'we', 'they', 'you',
  'me', 'him', 'her', 'us', 'them', 'it'
];

var copulas = [
  'is', 'are', 'am', 'was', 'were'
];

function decluster(terms){
  var newTerms = [];
  for (var i = 0; i < terms.length; i++){
    var term = terms[i];
    var split = term.text.split(/\s/);
    if (split.length >= 4){ // any cluster this large is almost certainly tagged incorrectly
      term.shouldBeDiscarded = true;
      newTerms.push(term);
    }
    else if (split.length > 1){
      var first = split[0];
      var last  = split[split.length - 1];
      var firstTerm = null;
      var lastTerm  = null;

      // split off first term if necessary
      var firstNorm = normalize(first);
      if (contains(determiners, firstNorm)){
        firstTerm = {text: first, pos: {Determiner: true}};
      } else if (contains(pronouns, firstNorm)){
        firstTerm = {text: first, pos: {Pronoun: true}};
      } else if (contains(copulas, firstNorm) && normalize(split[1]) !== 'not'){
        firstTerm = {text: first, pos: {Copula: true}};
      }

      // split off second term if necessary
      var lastNorm = normalize(last);
      if (contains(determiners, lastNorm)){
        lastTerm = {text: last, pos: {Determiner: true}};
      } else if (contains(pronouns, lastNorm)){
        lastTerm = {text: last, pos: {Pronoun: true}};
      } else if (contains(copulas, lastNorm)){
        lastTerm = {text: last, pos: {Copula: true}};
      }

      // figure out what text still belongs in the middle term
      var firstIdx = firstTerm ? first.length + 1 : 0;
      var lastIdx  = lastTerm  ? term.text.length - (last.length + 1) : undefined;
      var midText  = term.text.substring(firstIdx, lastIdx);

      // reconstruct the middle term based on whether or not we split off other terms
      var midTerm = {text: midText, pos: term.pos};
      if ((firstTerm && firstTerm.pos.Pronoun) || (lastTerm && lastTerm.pos.Pronoun)) {
        delete midTerm.pos.Pronoun;
      }
      if ((firstTerm && firstTerm.pos.Copula) || (lastTerm && lastTerm.pos.Copula)) {
        delete midTerm.pos.Copula;
      }

      // push all the new terms onto the list
      if (firstTerm) newTerms.push(firstTerm);
      if (!isEmptyOrWhitespace(midText)) newTerms.push(midTerm);
      if (lastTerm) newTerms.push(lastTerm);
    }
    else {
      newTerms.push(term);
    }
  }
  return newTerms;
}

function shouldDiscard(term, text){
  return term.shouldBeDiscarded ||
         isEmptyOrWhitespace(text) ||
         contains(blacklist, text) ||
         term.text.indexOf('—') !== -1;
}

function classify(term){
  var text = normalize(term.text);
  // GARBAGE
  // we don't care about these
  if (shouldDiscard(term, text)){
    term.cat = {Discarded: true};
  }
  // CONTRACTIONS
  // handle these early so we don't misclassify them as something else by mistake
  else if (term.text.indexOf("'") !== -1 || term.text.indexOf('’') !== -1){
    term.cat = {Contraction: true};
  }
  // SPECIFIC WORDS
  // these are exceptions to the normal rules, and have to be handled manually
  else if (text === 'and'){
    term.cat = {And: true};
  }
  else if (text === 'just'){
    term.cat = {Adjective: true};
  }
  else if (text === 'way'){
    term.cat = {NormalNoun: true};
    term.requiredCount = COUNT_SINGULAR;
  }
  // SPECIALS
  // these have to undergo further type-specific classification
  else if (term.pos.Copula || contains(copulas, text)){
    classifyCopula(term);
  }
  else if (term.pos.Determiner || contains(determiners, text)){
    classifyDeterminer(term);
  }
  else if (term.pos.Possessive){
    classifyPossessive(term);
  }
  else if (term.pos.Pronoun || contains(pronouns, text)){
    classifyPronoun(term);
  }
  // SPECIAL NOUNLIKES
  // originally classified as nouns, but shouldn't be treated like "normal" nouns
  else if (term.pos.Date){
    term.cat = {Date: true};
  }
  else if (term.pos.Person && !term.pos.Pronoun){
    term.cat = {Person: true};
    term.requiredCount = term.pos.Plural ? COUNT_PLURAL : COUNT_SINGULAR;
  }
  else if (term.pos.Value){
    term.cat = {Value: true};
  }
  else if (term.pos.Url){
    term.cat = {Url: true};
  }
  // SPECIAL VERBLIKES
  // originally classified as verbs, but shouldn't be treated like "normal" verbs
  else if (term.pos.Modal){
    term.cat = {ModalVerb: true};
  }
  else if (isGerund(term)){
    term.cat = {Gerund: true};
    if (normalize(term.text) === 'being'){
      // special case: 'being' can be a gerund or a noun
      term.cat.NormalNoun = true;
      term.requiredCount = COUNT_SINGULAR;
    }
  }
  // ADVERBS
  // these are often originally classified as nouns for some reason
  else if (isAdverb(term)){
    term.cat = {Adverb: true};
  }
  // "NORMAL" PARTS OF SPEECH
  else if (term.pos.Adjective){
    term.cat = {Adjective: true};
  }
  else if (term.pos.Condition){
    term.cat = {Condition: true};
  }
  else if (term.pos.Conjunction){
    // TODO: most of these aren't useful, e.g. 'before'
    term.cat = {Conjunction: true};
  }
  else if (term.pos.Expression){
    // TODO: I have no idea what falls into this category besides 'please'
    term.cat = {Expression: true};
  }
  else if (term.pos.Noun){
    term.cat = {NormalNoun: true};
    term.requiredCount = term.pos.Plural ? COUNT_PLURAL : COUNT_SINGULAR;
    if (term.pos.Plural){
      term.cat.PluralNoun = true;
    }
  }
  else if (term.pos.Preposition){
    term.cat = {Preposition: true};
  }
  else if (term.pos.Question){
    term.cat = {Question: true};
  }
  else if (term.pos.Verb){
    classifyVerb(term);
  }
  // FALLTHROUGH
  else {
    term.cat = {};
    console.log('COULDN\'T CATEGORIZE TERM');
    console.log(term);
  }
}

function termify(text){
  // process the text with nlp_compromise to establish best-guess POS tags
  var sentences = nlp.text(text).sentences;
  var terms = flatten1(sentences.map(s => s.terms));

  // split up dubious clusters into separate terms
  terms = decluster(terms);

  // manually classify each term for our purposes
  terms.forEach(classify);

  return terms;
}

// pattern matching

function hasRequiredCount(term, requiredCount){
  if (requiredCount === COUNT_ANY || !term.requiredCount){
    return true;
  } else if (requiredCount === COUNT_I) {
    // 'I' takes 'am'/'was' for copula, plural forms otherwise
    return term.cat.Copula ? term.compatibleWithI : requiredCount === COUNT_PLURAL;
  } else {
    return requiredCount === term.requiredCount;
  }
}

function hasRequiredInitial(term, requiredInitial){
  if (requiredInitial === INITIAL_ANY || !requiredInitial){
    return true;
  } else {
    var initial = normalize(term.text).substring(0,1);
    var actual = contains(['a','e','i','o','u'], initial) ? INITIAL_VOWEL : INITIAL_CONSONANT;
    return requiredInitial === actual;
  }
}

function logTerm(term){
  console.log(term.text + ' | ' +
              Object.keys(term.pos).join(',') + ' | ' +
              Object.keys(term.cat).join(',') + ' | ' +
              term.requiredCount);
}

function shouldAccept(term, pos, count, initial){
  return term.cat[pos] &&
         hasRequiredCount(term, count) &&
         hasRequiredInitial(term, initial) &&
         Math.random() < 0.9;
}

function matchTermSequence(terms, pattern){
  terms = deepCopy(terms);
  var currTermIdx = 0;
  var currTerm;
  var patternIdx;
  var requiredCount = COUNT_ANY;
  var requiredInitial = INITIAL_ANY;

  // subject
  patternIdx = 0;
  while (patternIdx < pattern.subject.length){
    currTerm = terms[currTermIdx];
    if (!currTerm) return null; // no more terms to try!
    if (shouldAccept(currTerm, pattern.subject[patternIdx], requiredCount, requiredInitial)){
      currTerm.marked = true;
      patternIdx += 1;
      if (currTerm.requiredCount){
        requiredCount = currTerm.requiredCount;
      }
      if (currTerm.requiredInitial){
        requiredInitial = currTerm.requiredInitial;
      } else {
        requiredInitial = INITIAL_ANY;
      }
    }
    currTermIdx += 1;
  }

  // verb
  var isModal = pattern.verb[0] === 'ModalVerb';
  if (isModal){
    requiredCount = COUNT_PLURAL;
  }
  patternIdx = 0;
  while (patternIdx < pattern.verb.length){
    currTerm = terms[currTermIdx];
    if (!currTerm) return null; // no more terms to try!
    if (shouldAccept(currTerm, pattern.verb[patternIdx], requiredCount) &&
        !(isModal && (currTerm.pos.PastTense || currTerm.pos.PluperfectTense))){
      currTerm.marked = true;
      patternIdx += 1;
    }
    currTermIdx += 1;
  }

  // object
  requiredCount = COUNT_ANY;
  patternIdx = 0;
  while (patternIdx < pattern.object.length){
    currTerm = terms[currTermIdx];
    if (!currTerm) return null; // no more terms to try!
    if (shouldAccept(currTerm, pattern.object[patternIdx], requiredCount, requiredInitial)){
      currTerm.marked = true;
      patternIdx += 1;
      if (currTerm.requiredCount){
        requiredCount = currTerm.requiredCount;
      }
      if (currTerm.requiredInitial){
        requiredInitial = currTerm.requiredInitial;
      } else {
        requiredInitial = INITIAL_ANY;
      }
    }
    currTermIdx += 1;
  }

  return terms; // if we've gotten this far, all the terms were found
}

function poemify(selector){
  var nodes = document.querySelectorAll(selector);
  for (var i = 0; i < nodes.length; i++){
    // get a series of terms from the node's text
    var node = nodes[i];
    if (node.innerText.length < 10) continue; // bail out early if the text is way too short
    console.log(node.innerText);
    var terms = termify(node.innerText);

    // mark terms to keep (i.e. not black out)
    var matchedTerms = null;
    var attempts = 0;
    while (!matchedTerms && attempts < 20){
      var pattern = randNth(patterns);
      matchedTerms = matchTermSequence(terms, pattern);
      if (matchedTerms){
        console.log(pattern.subject.concat(pattern.verb).concat(pattern.object).join(','));
        var marked = (matchedTerms || []).filter(t => t.marked);
        console.log(marked.map(t => t.text).join(' '));
        marked.map(logTerm);
      }
      attempts += 1;
    }
    if (matchedTerms){
      terms = matchedTerms;
    }

    // write text back into the node with most terms blacked out
    var innerHTML = '';
    var prevWasBlackedOut = false;
    var blackoutColor = getComputedStyle(node).getPropertyValue('color');
    var blackoutPrefix = ' <span style="background:' + blackoutColor + '">';
    for (var j = 0; j < terms.length; j++){
      var term = terms[j];
      if (term.marked){
        if (prevWasBlackedOut){
          innerHTML = innerHTML + '</span> ' + term.text;
        } else {
          innerHTML = innerHTML + ' ' + term.text;
        }
        prevWasBlackedOut = false;
      } else {
        if (prevWasBlackedOut){
          innerHTML = innerHTML + ' ' + term.text;
        } else {
          innerHTML = innerHTML + blackoutPrefix + term.text;
        }
        prevWasBlackedOut = true;
      }
    }
    node.innerHTML = innerHTML;
  }
}

poemify('p, li');
})();
