"use strict";

var fs = require("fs");
var path = require("path");
var test = require("tape");
var inline = require("./");

test("default", function(t) {
  t.equal(
    inline("<span></span>", "span { color: red }"),
    "<span style=\"color:red;\"></span>"
  );
  t.end();
});

testFromFile("test/cases/alpha");

function testFromFile(basename) {
  test(basename, function(t) {
    var basepath = path.join(__dirname, basename);
    var html = fs.readFileSync(basepath + ".html", "utf8");
    var css = fs.readFileSync(basepath + ".css", "utf8");
    var expected = fs.readFileSync(basepath + ".out", "utf8");
    t.equal(inline(html, css), expected);
    t.end();
  });
}
