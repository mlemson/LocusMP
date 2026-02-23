/**
 * ============================================================
 * LOCUS MULTIPLAYER — Firebase Cloud Functions (Backend)
 * ============================================================
 * Server-authoritative game logic.
 * Deploy met: firebase deploy --only functions
 *
 * Functies:
 *   - createGame:    Maak een nieuw spel
 *   - joinGame:      Join met invite code
 *   - startGame:     Host start het spel
 *   - chooseGoal:    Kies een objective
 *   - playMove:      Speel een kaart
 *   - passMove:      Sla beurt over
 *   - getGameState:  Haal game state op
 * ============================================================
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();
const GameRules = require("./shared/game-rules");

// ──────────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────────

/** Genereer een korte invite code (6 chars, uppercase) */
function generateInviteCode() {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // geen I/O/0/1 (leesbaar)
	let code = '';
	for (let i = 0; i < 6; i++) {
		code += chars[Math.floor(Math.random() * chars.length)];
	}
	return code;
}

/** Haal authenticated user ID op */
function getAuthUserId(context) {
	if (!context.auth) {
		throw new functions.https.HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
	}
	return context.auth.uid;
}

/** Sanitize game state voor client (verberg andere spelers hun kaarten) */
function sanitizeGameStateForPlayer(gameState, playerId) {
	const sanitized = JSON.parse(JSON.stringify(gameState));

	for (const pid of Object.keys(sanitized.players)) {
		if (pid !== playerId) {
			// Verberg hand en deck van andere spelers
			sanitized.players[pid].hand = sanitized.players[pid].hand.map(() => ({ hidden: true }));
			sanitized.players[pid].drawPile = sanitized.players[pid].drawPile.length; // alleen count
			sanitized.players[pid].deck = []; // verberg deck

			// Verberg gekozen objective (privé!)
			if (sanitized.players[pid].chosenObjective) {
				sanitized.players[pid].chosenObjective = { hidden: true };
			}
		}

		// Verberg objective keuzes van andere spelers
		if (pid !== playerId && sanitized.objectiveChoices && sanitized.objectiveChoices[pid]) {
			sanitized.objectiveChoices[pid] = [];
		}
	}

	return sanitized;
}

// ──────────────────────────────────────────────
//  CREATE GAME
// ──────────────────────────────────────────────

exports.createGame = functions.https.onCall(async (data, context) => {
	const userId = getAuthUserId(context);
	const playerName = String(data.playerName || 'Speler').slice(0, 20);
	const maxPlayers = Math.min(8, Math.max(2, Number(data.maxPlayers) || 4));
	const cardsPerPlayer = Math.min(16, Math.max(4, Number(data.cardsPerPlayer) || 8));

	const gameId = db.collection('games').doc().id;
	const inviteCode = generateInviteCode();
	const seed = Date.now() + Math.floor(Math.random() * 100000);

	const gameState = GameRules.createGameState(gameId, userId, {
		seed,
		maxPlayers,
		cardsPerPlayer,
		handSize: 3
	});

	// Host toevoegen als eerste speler
	GameRules.addPlayer(gameState, userId, playerName);

	// Invite code apart opslaan voor lookup
	await db.collection('inviteCodes').doc(inviteCode).set({
		gameId,
		createdAt: admin.firestore.FieldValue.serverTimestamp()
	});

	// Game state opslaan
	await db.collection('games').doc(gameId).set({
		...gameState,
		inviteCode,
		updatedAt: admin.firestore.FieldValue.serverTimestamp()
	});

	return {
		gameId,
		inviteCode,
		playerId: userId
	};
});

// ──────────────────────────────────────────────
//  JOIN GAME
// ──────────────────────────────────────────────

exports.joinGame = functions.https.onCall(async (data, context) => {
	const userId = getAuthUserId(context);
	const playerName = String(data.playerName || 'Speler').slice(0, 20);
	const inviteCode = String(data.inviteCode || '').toUpperCase().trim();

	if (!inviteCode || inviteCode.length !== 6) {
		throw new functions.https.HttpsError('invalid-argument', 'Ongeldige invite code.');
	}

	// Zoek game via invite code
	const codeDoc = await db.collection('inviteCodes').doc(inviteCode).get();
	if (!codeDoc.exists) {
		throw new functions.https.HttpsError('not-found', 'Invite code niet gevonden.');
	}
	const { gameId } = codeDoc.data();

	// Atomic update via transaction
	const result = await db.runTransaction(async (tx) => {
		const gameRef = db.collection('games').doc(gameId);
		const gameSnap = await tx.get(gameRef);

		if (!gameSnap.exists) {
			throw new functions.https.HttpsError('not-found', 'Spel niet gevonden.');
		}

		const gameState = gameSnap.data();

		// Check of speler al in het spel zit
		if (gameState.players[userId]) {
			return { gameId, playerId: userId, alreadyJoined: true };
		}

		const addResult = GameRules.addPlayer(gameState, userId, playerName);
		if (addResult.error) {
			throw new functions.https.HttpsError('failed-precondition', addResult.error);
		}

		tx.update(gameRef, {
			players: gameState.players,
			playerOrder: gameState.playerOrder,
			updatedAt: admin.firestore.FieldValue.serverTimestamp()
		});

		return { gameId, playerId: userId };
	});

	return result;
});

// ──────────────────────────────────────────────
//  START GAME
// ──────────────────────────────────────────────

exports.startGame = functions.https.onCall(async (data, context) => {
	const userId = getAuthUserId(context);
	const gameId = String(data.gameId || '');

	if (!gameId) {
		throw new functions.https.HttpsError('invalid-argument', 'gameId is verplicht.');
	}

	const result = await db.runTransaction(async (tx) => {
		const gameRef = db.collection('games').doc(gameId);
		const gameSnap = await tx.get(gameRef);

		if (!gameSnap.exists) {
			throw new functions.https.HttpsError('not-found', 'Spel niet gevonden.');
		}

		const gameState = gameSnap.data();

		if (gameState.hostPlayerId !== userId) {
			throw new functions.https.HttpsError('permission-denied', 'Alleen de host kan het spel starten.');
		}

		const startResult = GameRules.startGame(gameState);
		if (startResult.error) {
			throw new functions.https.HttpsError('failed-precondition', startResult.error);
		}

		tx.update(gameRef, {
			...gameState,
			updatedAt: admin.firestore.FieldValue.serverTimestamp()
		});

		return { success: true };
	});

	return result;
});

// ──────────────────────────────────────────────
//  CHOOSE GOAL
// ──────────────────────────────────────────────

exports.chooseGoal = functions.https.onCall(async (data, context) => {
	const userId = getAuthUserId(context);
	const gameId = String(data.gameId || '');
	const objectiveIndex = Number(data.objectiveIndex);

	if (!gameId) {
		throw new functions.https.HttpsError('invalid-argument', 'gameId is verplicht.');
	}
	if (!Number.isFinite(objectiveIndex) || objectiveIndex < 0 || objectiveIndex > 2) {
		throw new functions.https.HttpsError('invalid-argument', 'objectiveIndex moet 0, 1 of 2 zijn.');
	}

	const result = await db.runTransaction(async (tx) => {
		const gameRef = db.collection('games').doc(gameId);
		const gameSnap = await tx.get(gameRef);

		if (!gameSnap.exists) {
			throw new functions.https.HttpsError('not-found', 'Spel niet gevonden.');
		}

		const gameState = gameSnap.data();
		const chooseResult = GameRules.chooseObjective(gameState, userId, objectiveIndex);

		if (chooseResult.error) {
			throw new functions.https.HttpsError('failed-precondition', chooseResult.error);
		}

		tx.update(gameRef, {
			...gameState,
			updatedAt: admin.firestore.FieldValue.serverTimestamp()
		});

		return { success: true, allChosen: chooseResult.allChosen };
	});

	return result;
});

// ──────────────────────────────────────────────
//  PLAY MOVE
// ──────────────────────────────────────────────

exports.playMove = functions.https.onCall(async (data, context) => {
	const userId = getAuthUserId(context);
	const gameId = String(data.gameId || '');
	const cardId = String(data.cardId || '');
	const zoneName = String(data.zoneName || '');
	const baseX = Number(data.baseX);
	const baseY = Number(data.baseY);
	const rotation = Number(data.rotation || 0);
	const mirrored = !!data.mirrored;

	if (!gameId || !cardId || !zoneName) {
		throw new functions.https.HttpsError('invalid-argument', 'gameId, cardId en zoneName zijn verplicht.');
	}
	if (!Number.isFinite(baseX) || !Number.isFinite(baseY)) {
		throw new functions.https.HttpsError('invalid-argument', 'baseX en baseY moeten getallen zijn.');
	}

	const result = await db.runTransaction(async (tx) => {
		const gameRef = db.collection('games').doc(gameId);
		const gameSnap = await tx.get(gameRef);

		if (!gameSnap.exists) {
			throw new functions.https.HttpsError('not-found', 'Spel niet gevonden.');
		}

		const gameState = gameSnap.data();
		const moveResult = GameRules.playMove(
			gameState, userId, cardId, zoneName,
			baseX, baseY, rotation, mirrored
		);

		if (moveResult.error) {
			throw new functions.https.HttpsError('failed-precondition', moveResult.error);
		}

		tx.update(gameRef, {
			...gameState,
			updatedAt: admin.firestore.FieldValue.serverTimestamp()
		});

		return moveResult;
	});

	return result;
});

// ──────────────────────────────────────────────
//  PASS MOVE
// ──────────────────────────────────────────────

exports.passMove = functions.https.onCall(async (data, context) => {
	const userId = getAuthUserId(context);
	const gameId = String(data.gameId || '');

	if (!gameId) {
		throw new functions.https.HttpsError('invalid-argument', 'gameId is verplicht.');
	}

	const result = await db.runTransaction(async (tx) => {
		const gameRef = db.collection('games').doc(gameId);
		const gameSnap = await tx.get(gameRef);

		if (!gameSnap.exists) {
			throw new functions.https.HttpsError('not-found', 'Spel niet gevonden.');
		}

		const gameState = gameSnap.data();
		const passResult = GameRules.passMove(gameState, userId);

		if (passResult.error) {
			throw new functions.https.HttpsError('failed-precondition', passResult.error);
		}

		tx.update(gameRef, {
			...gameState,
			updatedAt: admin.firestore.FieldValue.serverTimestamp()
		});

		return passResult;
	});

	return result;
});

// ──────────────────────────────────────────────
//  GET GAME STATE (real-time via onSnapshot, maar
//  ook als callable voor initiële load)
// ──────────────────────────────────────────────

exports.getGameState = functions.https.onCall(async (data, context) => {
	const userId = getAuthUserId(context);
	const gameId = String(data.gameId || '');

	if (!gameId) {
		throw new functions.https.HttpsError('invalid-argument', 'gameId is verplicht.');
	}

	const gameSnap = await db.collection('games').doc(gameId).get();
	if (!gameSnap.exists) {
		throw new functions.https.HttpsError('not-found', 'Spel niet gevonden.');
	}

	const gameState = gameSnap.data();

	// Check of speler in het spel zit
	if (!gameState.players[userId]) {
		throw new functions.https.HttpsError('permission-denied', 'Je zit niet in dit spel.');
	}

	return sanitizeGameStateForPlayer(gameState, userId);
});

// ──────────────────────────────────────────────
//  CLEANUP — automatische verwijdering van
//  verlopen games (optioneel, scheduled)
// ──────────────────────────────────────────────

exports.cleanupOldGames = functions.pubsub
	.schedule('every 24 hours')
	.onRun(async (context) => {
		const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 dagen oud
		const oldGames = await db.collection('games')
			.where('createdAt', '<', cutoff)
			.limit(100)
			.get();

		const batch = db.batch();
		oldGames.forEach(doc => batch.delete(doc.ref));
		await batch.commit();

		console.log(`Cleaned up ${oldGames.size} old games`);
		return null;
	});
