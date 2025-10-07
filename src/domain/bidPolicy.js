export class BidPolicy {
  constructor(config) {
    this.cfg = config;
  }

  isIncrementCandidate(priceIncrement) {
    return Number.isFinite(priceIncrement) && priceIncrement >= this.cfg.INCREMENT_THRESHOLD;
  }

  isMyLastBid(lastBid, myUserId) {
    const lastFromId = Number(lastBid?.from?.id);
    const myId = Number(myUserId);
    return Number.isFinite(lastFromId) && Number.isFinite(myId) && lastFromId === myId;
  }

  computeBidAmount(price, lastBidAmount) {
    const base = Number.isFinite(lastBidAmount) ? lastBidAmount : price;
    const multiplied = base * this.cfg.BID_INCREMENT_FACTOR;
    const roundedUp = Math.ceil(multiplied);
    const minIncrement = base + 1;
    return Math.max(roundedUp, minIncrement);
  }

  timeRemainingMs(untilEpoch, now = Date.now()) {
    const until = Number(untilEpoch);
    if (!Number.isFinite(until)) return Number.POSITIVE_INFINITY;
    const untilMs = until > 1e12 ? until : until * 1000;
    return untilMs - now;
  }

  isAuctionEndingSoon(untilEpoch, now = Date.now()) {
    const remainingMs = this.timeRemainingMs(untilEpoch, now);
    return Number.isFinite(remainingMs) && remainingMs > 0 && remainingMs <= this.cfg.MAX_AUCTION_TIME_MS;
  }

  isReadyToBid(untilEpoch, now = Date.now()) {
    const remainingMs = this.timeRemainingMs(untilEpoch, now);
    return Number.isFinite(remainingMs) && remainingMs > 0 && remainingMs <= this.cfg.BID_READY_THRESHOLD_MS;
  }

  withinCap(bidAmount, price) {
    const cap = Math.floor(price * this.cfg.MAX_PRICE_MULTIPLIER);
    return bidAmount <= cap;
  }
}
