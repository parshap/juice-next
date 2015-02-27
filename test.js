"use strict";

var test = require("tape");
var inline = require("./");

test("default", function(t) {
  t.equal(
    inline("<span></span>", "span { color: red }"),
    "<span style=\"color:red;\"></span>"
  );
  t.end();
});
