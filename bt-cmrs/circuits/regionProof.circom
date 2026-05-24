pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template RegionProof() {
    signal input x;
    signal input y;
    signal input r;

    signal input minX;
    signal input maxX;
    signal input minY;
    signal input maxY;
    signal input regionHash;
    signal input commitment;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== x;
    hasher.inputs[1] <== y;
    hasher.inputs[2] <== r;
    commitment === hasher.out;

    component geMinX = GreaterEqThan(32);
    geMinX.in[0] <== x;
    geMinX.in[1] <== minX;
    geMinX.out === 1;

    component leMaxX = LessEqThan(32);
    leMaxX.in[0] <== x;
    leMaxX.in[1] <== maxX;
    leMaxX.out === 1;

    component geMinY = GreaterEqThan(32);
    geMinY.in[0] <== y;
    geMinY.in[1] <== minY;
    geMinY.out === 1;

    component leMaxY = LessEqThan(32);
    leMaxY.in[0] <== y;
    leMaxY.in[1] <== maxY;
    leMaxY.out === 1;

    component regionHasher = Poseidon(4);
    regionHasher.inputs[0] <== minX;
    regionHasher.inputs[1] <== maxX;
    regionHasher.inputs[2] <== minY;
    regionHasher.inputs[3] <== maxY;
    regionHash === regionHasher.out;
}

component main { public [minX, maxX, minY, maxY, regionHash, commitment] } = RegionProof();
