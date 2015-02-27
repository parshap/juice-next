"use strict";

var htmlparser = require("htmlparser2");
var stringifyDOM = require("dom-serializer");
var parseCSS = require("css").parse;
var CSSCompiler = require("css/lib/stringify/compress");
var select = require("css-select");
var specificity = require("specificity");

module.exports = function(html, css) {
  var dom = parseDOM(html);
  var cssTree = parseCSS(css);
  forEachElement(dom, initializeStyles);
  initializeStyles(dom);
  applyStyles(dom, cssTree);
  forEachElement(dom, insertPseudoElements);
  forEachElement(dom, setStyleAttribute);
  return stringifyDOM(dom);
};

function initializeStyles(el) {
  el.styles = [];
  if (el.attribs && el.attribs.style) {
    var declarations = parseStyleAttribute(el.attribs.style);
    el.styles.push({
      declarations: declarations,
      specificity: "1,0,0,0",
    });
  }
}

function parseStyleAttribute(style) {
  var csstree = parseCSS("* { " + style + " }");
  return csstree.stylesheet.rules[0].declarations;
}

// Apply styles from the given css ast to each dom element, adding style
// objects to the elements' `styles` array (see the `initializeStyles`
// function).
function applyStyles(dom, cssTree) {
  forEachRule(cssTree.stylesheet, function(rule) {
    rule.selectors.forEach(function(selector) {
      var elements = getMatchingElements(selector, dom);
      elements.forEach(function(el) {
        el.styles.push({
          declarations: rule.declarations,
          specificity: getSpecificity(selector),
        });
      });
    });
  });
}

function getMatchingElements(selector, dom) {
  return select(selector, dom);
}

function setStyleAttribute(el) {
  if ( ! el.styles) {
    return;
  }

  var decls = computeDeclarations(el.styles);
  if (decls.length > 0) {
    el.attribs.style = stringifyDeclarations(decls);
  }
}

function insertPseudoElements(element) {
}

// Return a sorted array of css properties that gtgt
function computeDeclarations(styles) {
  // Don't mutate the input
  styles = styles.slice();
  sortBySpecificty(styles);
  var declarations = styles.reduce(function(acc, style) {
    return acc.concat(style.declarations);
  }, []);
  var lastProps = {};
  declarations = declarations.filter(function(decl) {
    if (lastProps[decl.property] === decl.value) {
      return false;
    }
    lastProps[decl.property] = decl.value;
    return true;
  });
  return declarations;
}

function sortBySpecificty(styles) {
  return styles.sort(function(a, b) {
    return compareSelectorSpecificity(a.specificity, b.specificity);
  });
}

function compareSelectorSpecificity(a, b) {
  return a.localeCompare(b);
}

function stringifyDeclarations(declarations) {
  return new CSSCompiler().mapVisit(declarations);
}

// Sync htmlparser parser
function parseDOM(html) {
  // Since we already have html string and are going to call parser.done()
  // in a sync manner, we can just turn the parsing into a sync call.
  var dom, err;
  var parser = new htmlparser.Parser(
    new htmlparser.DomHandler(function(err2, dom2) {
      // This function will be called on
      err = err2;
      dom = dom2;
    })
  );
  parser.write(html);
  parser.done();
  if (err) {
    throw err;
  }
  return dom;
}

function forEachElement(elements, fn) {
  elements.forEach(function(el) {
    if (el.type === "tag") {
      fn(el);
    }
    if (el.children) {
      forEachElement(el.children, fn);
    }
  });
}

// Walk all rule nodes in the given css ast, calling a function for each rule
// node
function forEachRule(node, fn) {
  if (node.type === "rule") {
    fn(node);
  }
  if (node.rules) {
    node.rules.forEach(function(node) {
      forEachRule(node, fn);
    });
  }
}

// Get the specificity string for the given selector
function getSpecificity(selector) {
  return specificity.calculate(selector)[0].specificity;
}

// rules = parse css rules
//
// for each rule:
//   continue if rule should be ignored (e.g., some pseudo selectors)
//   for each element matching rule:
//     initialize list of properties from style attribute
//     add each rule property and specificity to list of properties
//
// for each pseudo element rule:
//   continue if rule should be ignored (e.g., some pseudo selectors)
//   strip pseudo part from selector
//   for each element matching selector:
//     element.pseudo[After|Before] = new <span>
//     element.pseudo.styles = each rule property and specificity
//
// insert pseudo element
//
// for each element:
//   set style attribute
//
