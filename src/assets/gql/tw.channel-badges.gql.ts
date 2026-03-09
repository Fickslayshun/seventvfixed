import gql from "graphql-tag";

export const twitchChannelBadgesQuery = gql`
	query ChannelBadges($login: String!) {
		badges {
			id
			image1x
			image2x
			image4x
			setID
			title
			version
			clickAction
			clickURL
			__typename
		}
		user(login: $login) {
			id
			login
			broadcastBadges {
				id
				image1x
				image2x
				image4x
				setID
				title
				version
				clickAction
				clickURL
				__typename
			}
		}
	}
`;

export namespace twitchChannelBadgesQuery {
	export interface Variables {
		login: string;
	}

	export interface Response {
		badges: Twitch.ChatBadge[];
		user: {
			id: string;
			login: string;
			broadcastBadges: Twitch.ChatBadge[];
		} | null;
	}
}
