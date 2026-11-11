// src/widgets/sims/index.js
//
// The simulators a `parameter-plot` widget can run instead of its generic
// curve: a page sets `config.sim` to one of these names, and each control's
// `key` names the parameter it drives (see each simulator for its keys and
// their defaults). Every simulator is a pure function (config, state) ->
// PlotSeries[], deterministic for the same inputs, so a redraw on every
// control change is cheap and repeatable.

import * as neurons from "./neurons.js";
import * as plasticity from "./plasticity.js";
import * as coding from "./coding.js";
import * as cortex from "./cortex.js";
import * as foundations from "./foundations.js";
import * as columns from "./columns.js";
import * as analog from "./analog.js";
import * as racing from "./racing.js";
import * as poker from "./poker.js";
import * as investing from "./investing.js";

export const SIMS = {
  lif: neurons.lif,
  "fi-curve": neurons.fiCurve,
  izhikevich: neurons.izhikevich,
  adex: neurons.adex,
  eif: neurons.eif,
  "eif-iv": neurons.eifIV,
  hh: neurons.hh,
  fhn: neurons.fhn,
  "morris-lecar": neurons.morrisLecar,
  srm: neurons.srm,
  "stochastic-lif": neurons.stochasticLif,
  "two-compartment": neurons.twoCompartment,
  ifb: neurons.ifb,
  "stdp-window": plasticity.stdpWindow,
  "stdp-triplet": plasticity.stdpTriplet,
  "stdp-multiplicative": plasticity.stdpMultiplicative,
  "stdp-voltage": plasticity.stdpVoltage,
  "stdp-reward": plasticity.stdpReward,
  bcm: plasticity.bcm,
  surrogate: plasticity.surrogate,
  encoding: coding.encoding,
  "synaptic-filter": coding.synapticFilter,
  population: coding.population,
  "winner-take-all": coding.winnerTakeAll,
  "event-driven": coding.eventDriven,
  "temporal-memory": cortex.temporalMemory,
  "thousand-brains": cortex.thousandBrains,
  "grid-cells": cortex.gridCells,
  "ring-attractor": cortex.ringAttractor,
  "mushroom-body": cortex.mushroomBody,
  "nef-tuning": foundations.nefTuning,
  "nef-decode": foundations.nefDecode,
  "spa-binding": foundations.spaBinding,
  ldn: foundations.ldn,
  "spatial-pooler": columns.spatialPooler,
  "dendrite-match": columns.dendriteMatch,
  "hebb-oja": columns.hebbOja,
  "adaptive-threshold": columns.adaptiveThreshold,
  "ei-amplifier": columns.eiAmplifier,
  "predictive-coding": columns.predictiveCoding,
  "laminar-flow": columns.laminarFlow,
  "cuba-coba": columns.cubaCoba,
  "nmda-dendrite": columns.nmdaDendrite,
  "izhikevich-network": columns.izhikevichNetwork,
  "path-integration": columns.pathIntegration,
  "scalar-encoder": columns.scalarEncoder,
  "evidence-inference": columns.evidenceInference,
  "mos-iv": analog.mosIV,
  "gm-from-id": analog.gmFromId,
  "cs-transfer": analog.csTransfer,
  "diff-pair": analog.diffPair,
  "current-mirror": analog.currentMirror,
  "cs-frequency": analog.csFrequency,
  "noise-spectrum": analog.noiseSpectrum,
  "feedback-gain": analog.feedbackGain,
  "step-response": analog.stepResponse,
  bandgap: analog.bandgap,
  "sc-integrator": analog.scIntegrator,
  "ring-oscillator": analog.ringOscillator,
  "tyre-curve": racing.tyreCurve,
  "cornering-speed": racing.corneringSpeed,
  "weight-transfer": racing.weightTransfer,
  "outs-odds": poker.outsOdds,
  "call-ev": poker.callEv,
  "bet-sizing": poker.betSizing,
  "risk-of-ruin": poker.ruin,
  "winrate-confidence": poker.winrateConfidence,
  "icm-equity": poker.icmEquity,
  "compound-growth": investing.compoundGrowth,
  "volatility-drag": investing.volatilityDrag,
  "bond-price-yield": investing.bondPriceYield,
  dcf: investing.dcf,
  "option-payoff": investing.optionPayoff,
  "option-greeks": investing.optionGreeks,
  frontier: investing.frontier,
  diversification: investing.diversification,
  sml: investing.sml,
  "carry-trade": investing.carryTrade,
  "leveraged-funds": investing.leveragedFunds,
  withdrawal: investing.withdrawal,
};
