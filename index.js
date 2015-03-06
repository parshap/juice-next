"use strict";

// # Juice
//
// 1. Parse the given html into a dom object. This dom object is used to hold
// state, and also what we use to later generate the html string to return.
//
// 2. Calculate the styles that apply to each element. This is based on
// existing inline styles and the given css. The result gets stored in each dom
// element object's `el.styles` property.  (stored in el.styles)
//
// 2. Mutate the dom object so that when we stringify it we get the result that
// we want (i.e, set the style attributes)
//

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
  "visited",
  "link"
];

// A regular expression to match "!important" in property values
var IMPORTANT_REGEX = /\s*!\s*important\s*$/;

// ## Entry point
//
// Take an html string and css string and return an html string with the css
// "inlined".
//

function juice(html, css) {
  // Parse the HTML and CSS into object models
  var dom = parseDOM(html);
  var cssTree = parseCSS(css, { silent: true });

  // Calculate the styles applied to each dom element, setting el.style for
  // each dom element object
  calculateStyles(dom, cssTree);

  // "Inline" styles by setting each element's style attribute based on
  // el.styles
  forEachElement(dom, setStyleAttribute);

  return stringifyDOM(dom);
}

// ## Calculate Styles
//
// For each element in the dom, calculate the styles that apply to it and store
// them in the `styles` property of the element object.
//

function calculateStyles(dom, cssTree) {
  // Initialize el.styles with the element's inline styles
  forEachElement(dom, initializeStyles);
  // Add matching css rules to each element's el.styles
  applyStyles(dom, cssTree);
}

// Initialize an element's `el.styles` property using its inline styles
function initializeStyles(el) {
  el.styles = [];
  if (el.attribs && el.attribs.style) {
    var declarations = parseStyleAttribute(el.attribs.style);
    el.styles.push({
      declarations: declarations,
      specificity: "1,0,0,0", // inline style specificity
    });
  }
}

// Parse a style attribute string (a set of declarations)
function parseStyleAttribute(style) {
  // Wrap the style declarations around a fake selector so that the CSS parser
  // can parse it.
  var csstree = parseCSS("fake-selector { " + style + " }");
  // Pull out just the declarations from the parsed object
  return csstree.stylesheet.rules[0].declarations;
}

// Apply styles from the given css ast to each dom element, adding style
// objects to the elements' `styles` array (see the `initializeStyles`
// function).
function applyStyles(dom, cssTree) {
  forEachRule(cssTree.stylesheet, function(rule) {
    var declarations = rule.declarations;
    var selectors = rule.selectors.filter(shouldApplySelector);
    selectors.forEach(function(selector) {
      // Create an object containing the declarations of this rule and its
      // specificity
      var style = {
        declarations: declarations,
        specificity: getSpecificity(selector),
      };
      // Add the style to all elements that match the selector
      select(selector, dom).forEach(function(el) {
        el.styles.push(style);
      });
    });
  });
}

// Determine if the selector should affect styles of matching elements.
// Selectors with pseudo elements and certain pseudo classes are ignored.
function shouldApplySelector(selector) {
  return toArray(parseSelector(selector)).every(function(part) {
    return toArray(part).every(function(part) {
      if ( ! part.pseudos) {
        return true;
      }
      return part.pseudos.every(function(pseudo) {
        return pseudo.type !== "element" &&
          IGNORED_PSEUDOS.indexOf(pseudo.name) === -1;
      });
    });
  });
}

// ## Inline Styles
//
// "Inline" styles by setting the element's style attribute based on its
// `styles` property that was populated earlier by calculateStyles().
//

function setStyleAttribute(el) {
  if ( ! el.styles) {
    // This element has no styles
    return;
  }

  var decls = computeDeclarations(el.styles);
  if (decls.length > 0) {
    el.attribs.style = stringifyDeclarations(decls);
  }
}

// Return a sorted array of css properties that gtgt
function computeDeclarations(styles) {
  var declarations = styles.reduce(function(acc, style) {
    // Add an extra dimension of specificity to take into account !important
    // so we can achieve the correct calculated styles without actually using
    // !important, as some email clients don't support properties with
    // !important.
    style.declarations.forEach(function(declaration) {
      // @TODO Don't mutate the input
      if (isValueImportant(declaration.value)) {
        declaration.specificity = "1," + style.specificity;
      }
      else {
        declaration.specificity = "0," + style.specificity;
      }
      // Strip !important since we account for it by sorting
      declaration.value = removeImportant(declaration.value);
    });
    return acc.concat(style.declarations);
  }, []);
  sortBySpecificty(declarations);
  declarations = filterDuplicateValues(declarations);
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

function filterDuplicateValues(declarations) {
  // Keep track of the last value for each css property so we can remove
  // duplicates with the same values.
  var lastProps = {};
  return declarations.filter(function(decl) {
    if (lastProps[decl.property] === decl.value) {
      return false;
    }
    lastProps[decl.property] = decl.value;
    return true;
  });
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

function isValueImportant(value) {
  return IMPORTANT_REGEX.test(value);
}

function removeImportant(value) {
  return value.replace(IMPORTANT_REGEX, "");
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
//

module.exports = juice;
