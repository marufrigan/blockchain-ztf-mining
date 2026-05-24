"use strict";

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1));
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function min(arr) {
  if (!arr.length) return null;
  return Math.min(...arr);
}

function max(arr) {
  if (!arr.length) return null;
  return Math.max(...arr);
}

module.exports = { mean, stddev, median, min, max };
