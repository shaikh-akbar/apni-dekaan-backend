// Pure-function tests for the loyalty rules (no database needed).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildJourney, evaluatePurchase } from '../src/services/loyalty.service.js';

const single = { minAmount: 500, multiple: false, maxPerPurchase: 10 };
const multi = { minAmount: 500, multiple: true, maxPerPurchase: 10 };

describe('evaluatePurchase', () => {
  it('₹499 → 0', () => assert.equal(evaluatePurchase({ finalAmount: 499 }, single), 0));
  it('₹499.99 → 0', () => assert.equal(evaluatePurchase({ finalAmount: 499.99 }, single), 0));
  it('exactly ₹500 → 1', () => assert.equal(evaluatePurchase({ finalAmount: 500 }, single), 1));
  it('₹999 → 1', () => assert.equal(evaluatePurchase({ finalAmount: 999 }, single), 1));
  it('₹1,000 → 1', () => assert.equal(evaluatePurchase({ finalAmount: 1000 }, single), 1));
  it('₹1,500 → 1 by default (not 3)', () => assert.equal(evaluatePurchase({ finalAmount: 1500 }, single), 1));
  it('₹1,500 → 3 when multiple counts enabled', () => assert.equal(evaluatePurchase({ finalAmount: 1500 }, multi), 3));
  it('multiple counts are capped', () => assert.equal(evaluatePurchase({ finalAmount: 100000 }, multi), 10));
  it('excluded purchase → 0', () => assert.equal(evaluatePurchase({ finalAmount: 5000, isEligible: false }, single), 0));
  it('decimal strings work', () => assert.equal(evaluatePurchase({ finalAmount: '500.00' }, single), 1));
});

describe('buildJourney', () => {
  const rewards = [
    { id: 1, name: 'Gift 1', requiredCount: 25, isActive: true },
    { id: 2, name: 'Gift 2', requiredCount: 50, isActive: true },
    { id: 3, name: 'Gift 3', requiredCount: 75, isActive: true },
  ];
  const settings = { goldThreshold: 100 };

  it('18 counts: every remaining distance is computed (spec §30)', () => {
    const j = buildJourney({ silverCount: 18, cardType: 'SILVER' }, rewards, [], settings);
    assert.deepEqual(j.milestones.map((m) => [m.requiredCount, m.remaining]), [[25, 7], [50, 32], [75, 57], [100, 82]]);
    assert.equal(j.nextMilestone.name, 'Gift 1');
    assert.equal(j.remainingToGold, 82);
    assert.equal(j.goldProgressPercent, 18);
    assert.equal(j.nextProgressPercent, 72); // 18 of 25
  });

  it('unlocked rewards are marked and next milestone moves on', () => {
    const held = [{ id: 9, rewardId: 1, milestone: 25, status: 'DELIVERED' }, { id: 10, rewardId: 2, milestone: 50, status: 'AVAILABLE' }];
    const j = buildJourney({ silverCount: 68, cardType: 'SILVER' }, rewards, held, settings);
    assert.deepEqual(j.milestones.map((m) => m.unlocked), [true, true, false, false]);
    assert.equal(j.nextMilestone.requiredCount, 75);
    assert.equal(j.nextMilestone.remaining, 7);
    assert.equal(j.availableRewards, 1);
  });

  it('gold members show 100% and no remaining', () => {
    const j = buildJourney({ silverCount: 104, cardType: 'GOLD' }, rewards, [], settings);
    assert.equal(j.goldProgressPercent, 100);
    assert.equal(j.remainingToGold, 0);
  });

  it('inactive rewards are hidden unless the customer already holds them', () => {
    const r = [...rewards, { id: 4, name: 'Old promo', requiredCount: 10, isActive: false }];
    assert.equal(buildJourney({ silverCount: 5, cardType: 'SILVER' }, r, [], settings).milestones.length, 4);
    const held = [{ id: 1, rewardId: 4, milestone: 10, status: 'CLAIMED' }];
    assert.equal(buildJourney({ silverCount: 12, cardType: 'SILVER' }, r, held, settings).milestones.length, 5);
  });
});
