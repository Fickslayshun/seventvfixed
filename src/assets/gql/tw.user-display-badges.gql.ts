import { twitchBadgeFragment } from "./tw.fragment.gql";
import gql from "graphql-tag";

export const twitchUserDisplayBadgesQuery = gql`
	query UserDisplayBadges($channelID: ID!, $login: String!) {
		user(login: $login, lookupType: ALL) {
			id
			login
			displayBadges(channelID: $channelID) {
				...badge
			}
		}
	}

	${twitchBadgeFragment}
`;

export namespace twitchUserDisplayBadgesQuery {
	export interface Variables {
		channelID: string;
		login: string;
	}

	export interface Response {
		user: {
			id: string;
			login: string;
			displayBadges: Twitch.ChatBadge[];
		} | null;
	}
}
