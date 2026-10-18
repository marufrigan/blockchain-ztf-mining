pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

// Region-membership proof for GeoZK-Miner.
//
// Private inputs : x, y  (mine coordinates, fixed-point micro-degrees, shifted to be non-negative)
//                  r     (blinding randomness of the geographic commitment)
// Public inputs  : minX, maxX, minY, maxY (approved rectangular region)
//                  regionHash  = Poseidon(minX, maxX, minY, maxY)
//                  commitment  = Poseidon(x, y, r)
//
// Statement: the prover knows (x, y, r) such that Poseidon(x, y, r) = commitment
// and minX <= x <= maxX and minY <= y <= maxY, where the bounds hash to regionHash.
//
// circomlib comparators are only sound when both operands fit in n bits, so every
// coordinate and bound is range-checked to 32 bits before it is compared.
template RegionProof(n) {
    signal input x;
    signal input y;
    signal input r;

    signal input minX;
    signal input maxX;
    signal input minY;
    signal input maxY;
    signal input regionHash;
    signal input commitment;

    // 1. Range checks (soundness of the n-bit comparators).
    component rx = Num2Bits(n);    rx.in <== x;
    component ry = Num2Bits(n);    ry.in <== y;
    component rminX = Num2Bits(n); rminX.in <== minX;
    component rmaxX = Num2Bits(n); rmaxX.in <== maxX;
    component rminY = Num2Bits(n); rminY.in <== minY;
    component rmaxY = Num2Bits(n); rmaxY.in <== maxY;

    // 2. Geographic commitment binding.
    component hasher = Poseidon(3);
    hasher.inputs[0] <== x;
    hasher.inputs[1] <== y;
    hasher.inputs[2] <== r;
    commitment === hasher.out;

    // 3. Region membership.
    component geMinX = GreaterEqThan(n);
    geMinX.in[0] <== x;
    geMinX.in[1] <== minX;
    geMinX.out === 1;

    component leMaxX = LessEqThan(n);
    leMaxX.in[0] <== x;
    leMaxX.in[1] <== maxX;
    leMaxX.out === 1;

    component geMinY = GreaterEqThan(n);
    geMinY.in[0] <== y;
    geMinY.in[1] <== minY;
    geMinY.out === 1;

    component leMaxY = LessEqThan(n);
    leMaxY.in[0] <== y;
    leMaxY.in[1] <== maxY;
    leMaxY.out === 1;

    // 4. Region binding to the auditor-approved region hash.
    component regionHasher = Poseidon(4);
    regionHasher.inputs[0] <== minX;
    regionHasher.inputs[1] <== maxX;
    regionHasher.inputs[2] <== minY;
    regionHasher.inputs[3] <== maxY;
    regionHash === regionHasher.out;
}

component main { public [minX, maxX, minY, maxY, regionHash, commitment] } = RegionProof(32);
