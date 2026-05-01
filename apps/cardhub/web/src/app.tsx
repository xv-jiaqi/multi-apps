import { Route, Routes } from 'react-router';
import { HomePage } from './pages/home';
import { SeriesListPage } from './pages/series-list';
import { SeriesDetailPage } from './pages/series-detail';
import { CardDetailPage } from './pages/card-detail';
import { SearchPage } from './pages/search';
import { LoginPage } from './pages/login';
import { RegisterPage } from './pages/register';
import { NotFoundPage } from './pages/not-found';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/series" element={<SeriesListPage />} />
      <Route path="/series/:seriesSlug" element={<SeriesDetailPage />} />
      <Route path="/cards/:cardSlug" element={<CardDetailPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
