/**
 * External dependencies
 */
import type { ForwardedRef } from 'react';

/**
 * WordPress dependencies
 */
import { useMemo, useReducer } from '@wordpress/element';
import isShallowEqual from '@wordpress/is-shallow-equal';

/**
 * Internal dependencies
 */
import type { WordPressComponentProps } from '../../context';
import { contextConnect, useContextSystem } from '../../context';
import { useCx } from '../../utils/hooks/use-cx';
import { patternMatch, findParent } from '../utils/router';
import { View } from '../../view';
import { NavigatorContext } from '../context';
import * as styles from '../styles';
import type {
	NavigatorProviderProps,
	NavigatorLocation,
	NavigatorContext as NavigatorContextType,
	NavigateOptions,
	Screen,
	NavigateToParentOptions,
} from '../types';
import deprecated from '@wordpress/deprecated';

type MatchedPath = ReturnType< typeof patternMatch >;

type RouterAction =
	| { type: 'add' | 'remove'; screen: Screen }
	| { type: 'goto'; path: string; options?: NavigateOptions }
	| { type: 'gotoparent'; options?: NavigateToParentOptions };

type RouterState = {
	initialPath: string;
	screens: Screen[];
	currentLocation: NavigatorLocation;
	matchedPath: MatchedPath;
	focusSelectors: Map< string, string >;
};

function addScreen( { screens }: RouterState, screen: Screen ) {
	if ( screens.some( ( s ) => s.path === screen.path ) ) {
		// eslint-disable-next-line no-console
		console.warn(
			`Navigator: a screen with path ${ screen.path } already exists.
The screen with id ${ screen.id } will not be added.`
		);
		return screens;
	}
	return [ ...screens, screen ];
}

function removeScreen( { screens }: RouterState, screen: Screen ) {
	return screens.filter( ( s ) => s.id !== screen.id );
}

function goTo(
	state: RouterState,
	path: string,
	options: NavigateOptions = {}
) {
	const { currentLocation, focusSelectors } = state;

	const {
		// Default assignments
		isBack = false,
		skipFocus = false,
		// Extract to avoid forwarding
		replace,
		focusTargetSelector,
		// Rest
		...restOptions
	} = options;

	if ( currentLocation?.path === path ) {
		return { currentLocation, focusSelectors };
	}

	let focusSelectorsCopy;

	// Set a focus selector that will be used when navigating
	// back to the current location.
	if ( focusTargetSelector && currentLocation?.path ) {
		if ( ! focusSelectorsCopy ) {
			focusSelectorsCopy = new Map( state.focusSelectors );
		}
		focusSelectorsCopy.set( currentLocation.path, focusTargetSelector );
	}

	// Get the focus selector for the new location.
	let currentFocusSelector;
	if ( isBack ) {
		if ( ! focusSelectorsCopy ) {
			focusSelectorsCopy = new Map( state.focusSelectors );
		}
		currentFocusSelector = focusSelectorsCopy.get( path );
		focusSelectorsCopy.delete( path );
	}

	return {
		currentLocation: {
			...restOptions,
			path,
			isBack,
			hasRestoredFocus: false,
			focusTargetSelector: currentFocusSelector,
			skipFocus,
		},
		focusSelectors: focusSelectorsCopy ?? focusSelectors,
	};
}

function goToParent(
	state: RouterState,
	options: NavigateToParentOptions = {}
) {
	const { currentLocation, screens, focusSelectors } = state;
	const currentPath = currentLocation?.path;
	if ( currentPath === undefined ) {
		return { currentLocation, focusSelectors };
	}
	const parentPath = findParent( currentPath, screens );
	if ( parentPath === undefined ) {
		return { currentLocation, focusSelectors };
	}
	return goTo( state, parentPath, {
		...options,
		isBack: true,
	} );
}

function routerReducer(
	state: RouterState,
	action: RouterAction
): RouterState {
	let {
		screens,
		currentLocation,
		matchedPath,
		focusSelectors,
		...restState
	} = state;
	switch ( action.type ) {
		case 'add':
			screens = addScreen( state, action.screen );
			break;
		case 'remove':
			screens = removeScreen( state, action.screen );
			break;
		case 'goto':
			const goToNewState = goTo( state, action.path, action.options );
			currentLocation = goToNewState.currentLocation;
			focusSelectors = goToNewState.focusSelectors;
			break;
		case 'gotoparent':
			const goToParentNewState = goToParent( state, action.options );
			currentLocation = goToParentNewState.currentLocation;
			focusSelectors = goToParentNewState.focusSelectors;
			break;
	}

	if ( currentLocation?.path === state.initialPath ) {
		currentLocation = { ...currentLocation, isInitial: true };
	}

	// Return early in case there is no change
	if (
		screens === state.screens &&
		currentLocation === state.currentLocation
	) {
		return state;
	}

	// Compute the matchedPath
	const currentPath = currentLocation?.path;
	matchedPath =
		currentPath !== undefined
			? patternMatch( currentPath, screens )
			: undefined;

	// If the new match is the same as the previous match,
	// return the previous one to keep immutability.
	if (
		matchedPath &&
		state.matchedPath &&
		matchedPath.id === state.matchedPath.id &&
		isShallowEqual( matchedPath.params, state.matchedPath.params )
	) {
		matchedPath = state.matchedPath;
	}

	return {
		...restState,
		screens,
		currentLocation,
		matchedPath,
		focusSelectors,
	};
}

function UnconnectedNavigatorProvider(
	props: WordPressComponentProps< NavigatorProviderProps, 'div' >,
	forwardedRef: ForwardedRef< any >
) {
	const {
		initialPath: initialPathProp,
		children,
		className,
		...otherProps
	} = useContextSystem( props, 'NavigatorProvider' );

	const [ routerState, dispatch ] = useReducer(
		routerReducer,
		initialPathProp,
		( path ) => ( {
			screens: [],
			currentLocation: { path },
			matchedPath: undefined,
			focusSelectors: new Map(),
			initialPath: initialPathProp,
		} )
	);

	// The methods are constant forever, create stable references to them.
	const methods = useMemo(
		() => ( {
			// Note: calling goBack calls `goToParent` internally, as it was established
			// that `goBack` should behave like `goToParent`, and `goToParent` should
			// be marked as deprecated.
			goBack: ( options: NavigateToParentOptions | undefined ) =>
				dispatch( { type: 'gotoparent', options } ),
			goTo: ( path: string, options?: NavigateOptions ) =>
				dispatch( { type: 'goto', path, options } ),
			goToParent: ( options: NavigateToParentOptions | undefined ) => {
				deprecated( `wp.components.useNavigator().goToParent`, {
					since: '6.7',
					alternative: 'wp.components.useNavigator().goBack',
				} );
				dispatch( { type: 'gotoparent', options } );
			},
			addScreen: ( screen: Screen ) =>
				dispatch( { type: 'add', screen } ),
			removeScreen: ( screen: Screen ) =>
				dispatch( { type: 'remove', screen } ),
		} ),
		[]
	);

	const { currentLocation, matchedPath } = routerState;

	const navigatorContextValue: NavigatorContextType = useMemo(
		() => ( {
			location: currentLocation,
			params: matchedPath?.params ?? {},
			match: matchedPath?.id,
			...methods,
		} ),
		[ currentLocation, matchedPath, methods ]
	);

	const cx = useCx();
	const classes = useMemo(
		() => cx( styles.navigatorProviderWrapper, className ),
		[ className, cx ]
	);

	return (
		<View ref={ forwardedRef } className={ classes } { ...otherProps }>
			<NavigatorContext.Provider value={ navigatorContextValue }>
				{ children }
			</NavigatorContext.Provider>
		</View>
	);
}

/**
 * The `NavigatorProvider` component allows rendering nested views/panels/menus
 * (via the `NavigatorScreen` component and navigate between these different
 * view (via the `NavigatorButton` and `NavigatorBackButton` components or the
 * `useNavigator` hook).
 *
 * ```jsx
 * import {
 *   __experimentalNavigatorProvider as NavigatorProvider,
 *   __experimentalNavigatorScreen as NavigatorScreen,
 *   __experimentalNavigatorButton as NavigatorButton,
 *   __experimentalNavigatorBackButton as NavigatorBackButton,
 * } from '@wordpress/components';
 *
 * const MyNavigation = () => (
 *   <NavigatorProvider initialPath="/">
 *     <NavigatorScreen path="/">
 *       <p>This is the home screen.</p>
 *        <NavigatorButton path="/child">
 *          Navigate to child screen.
 *       </NavigatorButton>
 *     </NavigatorScreen>
 *
 *     <NavigatorScreen path="/child">
 *       <p>This is the child screen.</p>
 *       <NavigatorBackButton>
 *         Go back
 *       </NavigatorBackButton>
 *     </NavigatorScreen>
 *   </NavigatorProvider>
 * );
 * ```
 */
export const NavigatorProvider = contextConnect(
	UnconnectedNavigatorProvider,
	'NavigatorProvider'
);

export default NavigatorProvider;
