"use strict";

var htmlparser = require("htmlparser2");
var stringifyDOM = require("dom-serializer");
var parseCSS = require("css").parse;
var select = require("css-select");
var specificity = require("specificity");
var parseSelector = require("slick/parser");
var toArray = require("to-array");

// Use css module internals. This is why we specify an exact version for the
// css module in package.json.
var CSSCompiler = require("css/lib/stringify/compress");

// Ignore selectors that use the following pseudo classes
var IGNORED_PSEUDOS = [
  "hover",
  "active",
  "focus",
  "visisted",
  "link"
];

function juice(html, css) {
  // We use dom to hold our state
  var dom = parseDOM(html);
  var cssTree = parseCSS(css);

  // Add el.styles to each dom element
  forEachElement(dom, initializeStyles);
  // Add matching css rules to each element's el.styles
  applyStyles(dom, cssTree);
  // Set the style attribute based on each element's el.styles
  forEachElement(dom, setStyleAttribute);
  return stringifyDOM(dom);
}

// Initialize an element's `el.styles` attribute with any inline styles
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

// Parse a style attribute string (a set of declarations)
function parseStyleAttribute(style) {
  var csstree = parseCSS("* { " + style + " }");
  return csstree.stylesheet.rules[0].declarations;
}

// Apply styles from the given css ast to each dom element, adding style
// objects to the elements' `styles` array (see the `initializeStyles`
// function).
function applyStyles(dom, cssTree) {
  forEachRule(cssTree.stylesheet, function(rule) {
    var selectors = rule.selectors.filter(shouldApplySelector);
    selectors.forEach(function(selector) {
      var elements = select(selector, dom);
      elements.forEach(function(el) {
        el.styles.push({
          declarations: rule.declarations,
          specificity: getSpecificity(selector),
        });
      });
    });
  });
}

// Determine if the given selector should be applied to the dom. Selectors with
// pseudo elements and selectors with certain ignored pseudo classes are
// not applied.
function shouldApplySelector(selector) {
  return toArray(parseSelector(selector)).every(function(part) {
    return toArray(part).every(function(part) {
      if ( ! part.pseudo) {
        return true;
      }
      return part.pseudos.every(function(pseudo) {
        return pseudo.type !== "element" &&
          IGNORED_PSEUDOS.indexOf(pseudo.name) === -1;
      });
    });
  });
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

// Stringify an array of css ast declaration objects
function stringifyDeclarations(declarations) {
  // Escape values
  declarations.forEach(function(declaration) {
    declaration.value = escapeDeclarationValue(declaration.value);
  });
  return new CSSCompiler().mapVisit(declarations);
}

function escapeDeclarationValue(value) {
  return value.replace(/["]/g, "'");
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

// Walk all dom nodes, calling a function for each element node
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

// ## Exports
module.exports = juice;
