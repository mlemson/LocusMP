const R = require('./shared/game-rules.js');

const gs = R.createGameState('g1', 'p1', { seed: 42 });
R.addPlayer(gs, 'p1', 'Host');
R.addPlayer(gs, 'p2', 'P2');
R.startGame(gs);
R.chooseStartingDeck(gs, 'p1', 'random');
R.chooseStartingDeck(gs, 'p2', 'random');
R.chooseObjective(gs, 'p1', 0);
R.chooseObjective(gs, 'p2', 0);

const curPlayer = gs.playerOrder[gs.currentTurnIndex];
const otherPlayer = gs.playerOrder.find(p => p !== curPlayer);
console.log('Current turn:', curPlayer, '| Other:', otherPlayer);

// Give steal perk
gs.players[curPlayer].perks.unlockedPerks = ['agg_steal'];
gs.players[curPlayer].perks.stealsPerRound = 1;

// Get stealable cards
const cards = R.getStealableCards(gs, curPlayer, otherPlayer);
console.log('Stealable:', cards.cards.map(c => `${c.shapeName}(${c.colorName})`).join(', '));

// Steal first card 
R.stealCard(gs, curPlayer, otherPlayer, cards.cards[0].id);
const stolenCard = gs.players[curPlayer].hand.find(c => c.isStolenTemp);
console.log('Stolen:', stolenCard.id, stolenCard.color.name, 'zone=' + stolenCard.color.zone);

const drawPileBefore = gs.players[otherPlayer].drawPile.length;
console.log(otherPlayer + ' drawPile before play:', drawPileBefore);

// Try to play on matching zone - brute force positions
const zoneName = stolenCard.color.zone;
const zoneData = gs.boardState.zones[zoneName];
console.log('Zone ' + zoneName + ': ' + zoneData.rows + 'x' + zoneData.cols);

let played = false;
for (let y = 0; y < zoneData.rows && !played; y++) {
    for (let x = 0; x < zoneData.cols && !played; x++) {
        for (let rot = 0; rot < 4 && !played; rot++) {
            for (const mir of [false, true]) {
                if (played) break;
                const r = R.playMove(gs, curPlayer, stolenCard.id, zoneName, x, y, rot, mir);
                if (r.success) {
                    console.log('\nPLAYED at (' + x + ',' + y + ') rot=' + rot + ' mir=' + mir);
                    const drawPileAfter = gs.players[otherPlayer].drawPile.length;
                    console.log(otherPlayer + ' drawPile after play:', drawPileAfter);
                    console.log('Card returned?', drawPileAfter === drawPileBefore + 1);
                    const ret = gs.players[otherPlayer].drawPile.find(c => c.id === stolenCard.id);
                    console.log('Found in drawPile?', !!ret);
                    console.log('isStolenTemp cleaned?', ret ? ret.isStolenTemp === undefined : 'N/A');
                    console.log('originalOwnerId cleaned?', ret ? ret.originalOwnerId === undefined : 'N/A');
                    played = true;
                }
            }
        }
    }
}
if (!played) {
    console.log('\nCould not place on board. Testing return logic manually...');
    // Manually simulate the return
    const cardIndex = gs.players[curPlayer].hand.findIndex(c => c.id === stolenCard.id);
    const card = gs.players[curPlayer].hand[cardIndex];
    gs.players[curPlayer].hand.splice(cardIndex, 1);
    if (card.isStolenTemp && card.originalOwnerId) {
        const originalOwner = gs.players[card.originalOwnerId];
        if (originalOwner) {
            const returnedCard = { ...card };
            delete returnedCard.isStolenTemp;
            delete returnedCard.originalOwnerId;
            originalOwner.drawPile.push(returnedCard);
            console.log('Manual return OK: card added to ' + card.originalOwnerId + ' drawPile');
            console.log('drawPile size:', originalOwner.drawPile.length);
            const ret = originalOwner.drawPile.find(c => c.id === card.id);
            console.log('Found?', !!ret, '| cleaned?', !ret.isStolenTemp && !ret.originalOwnerId);
        }
    }
}
