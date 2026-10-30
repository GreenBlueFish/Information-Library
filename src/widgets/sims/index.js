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
};
