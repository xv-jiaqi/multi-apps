export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/series/list/index',
    'pages/series/detail/index',
    'pages/cards/detail/index',
    'pages/search/index/index',
    'pages/auth/login/index',
    'pages/auth/register/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: 'Cardhub',
    navigationBarTextStyle: 'black',
    backgroundColor: '#fafafa',
  },
});
