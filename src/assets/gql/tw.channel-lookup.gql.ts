import gql from "graphql-tag";

export const twitchChannelLookupQuery = gql`
	query ChannelLookup($login: String!) {
		user(login: $login) {
			id
			login
			displayName
			stream {
				id
			}
		}
	}
`;

export namespace twitchChannelLookupQuery {
	export interface Variables {
		login: string;
	}

	export interface Response {
		user: {
			id: string;
			login: string;
			displayName: string;
			stream: {
				id: string;
			} | null;
		} | null;
	}
}
